/*
 * Owl Smile для OBS: доки с настоящими чатами Twitch и VK Live, в которые
 * встраивается бандл расширения (data/owl-obs.js) — так же, как OBS встраивает
 * BetterTTV/FFZ в свой док Twitch. Вход в аккаунты — прямо в доке, cookies хранит
 * наш cookie-менеджер, токены не нужны.
 *
 * Copyright (C) 2026 Owl Smile. GPL-2.0-or-later (как OBS и obs-browser).
 */
#include "owl.hpp"
#include "browser-panel.hpp"
#include "http-get.hpp"

#include <obs-frontend-api.h>
#include <obs-module.h>
#include <obs.hpp>
#include <plugin-support.h>
#include <util/platform.h>
#include <util/util.hpp>

#include <QAction>
#include <QApplication>
#include <QDateTime>
#include <QDialog>
#include <QDialogButtonBox>
#include <QFileInfo>
#include <QFormLayout>
#include <QLabel>
#include <QLineEdit>
#include <QMainWindow>
#include <QPushButton>
#include <QRegularExpression>
#include <QTimer>
#include <QVBoxLayout>

#include <atomic>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <thread>

namespace {

const char *DATA_URL = "https://gitflic.ru/project/ju1iana/owl-smile-data/file/downloadAll?branch=master&format=zip";
const int SYNC_MINUTES = 15;
const size_t MAX_ZIP_BYTES = 64 * 1024 * 1024;
const char *COOKIES = "owl_smile_cookies";

/* Страницы входа, которые должны открываться внутри OBS, а не в обычном браузере:
 * иначе вход окажется в браузере, а док останется без него. */
const char *LOGIN_POPUPS[] = {
	"https://id.vk.com", "https://login.vk.com", "https://oauth.vk.com", "https://vk.com/login",
	"https://live.vkvideo.ru", "https://www.twitch.tv/login", "https://passport.twitch.tv",
};

QString tr8(const char *s)
{
	return QString::fromUtf8(s);
}

std::string config_file(const char *name)
{
	BPtr<char> path = obs_module_config_path(name);
	const char *p = path;
	return p ? std::string(p) : std::string();
}

std::filesystem::path fs_path(const std::string &utf8)
{
	return std::filesystem::u8path(utf8);
}

bool read_file(const std::string &path, std::string &out)
{
	std::ifstream f(fs_path(path), std::ios::binary);
	if (!f)
		return false;
	out.assign(std::istreambuf_iterator<char>(f), std::istreambuf_iterator<char>());
	return true;
}

bool write_file(const std::string &path, const std::string &data)
{
	std::error_code ec;
	std::filesystem::create_directories(fs_path(path).parent_path(), ec);
	std::ofstream f(fs_path(path), std::ios::binary | std::ios::trunc);
	if (!f)
		return false;
	f.write(data.data(), (std::streamsize)data.size());
	return (bool)f;
}

/* «https://www.twitch.tv/Name», «twitch.tv/name/», «Name» → «name». Пусто — не канал. */
std::string twitch_login(const QString &raw)
{
	QString s = raw.trimmed();
	static const QRegularExpression url(R"(^(?:https?://)?(?:www\.|m\.)?twitch\.tv/(?:popout/)?([A-Za-z0-9_]+))");
	auto m = url.match(s);
	if (m.hasMatch())
		s = m.captured(1);
	s = s.toLower();
	static const QRegularExpression login(R"(^[a-z0-9_]{1,25}$)");
	return login.match(s).hasMatch() ? s.toStdString() : std::string();
}

/* «https://live.vkvideo.ru/name», «name» → «name». */
std::string vk_channel(const QString &raw)
{
	QString s = raw.trimmed();
	static const QRegularExpression url(R"(^(?:https?://)?live\.vkvideo\.ru/([^/?#\s]+))");
	auto m = url.match(s);
	if (m.hasMatch())
		s = m.captured(1);
	static const QRegularExpression name(R"(^[A-Za-z0-9_.\-]{1,64}$)");
	return name.match(s).hasMatch() ? s.toStdString() : std::string();
}

struct Settings {
	std::string twitch; // логин канала
	std::string vk;     // адрес канала на live.vkvideo.ru
};

Settings load_settings()
{
	Settings s;
	OBSDataAutoRelease data = obs_data_create_from_json_file_safe(config_file("settings.json").c_str(), "bak");
	if (data) {
		s.twitch = obs_data_get_string(data, "twitch");
		s.vk = obs_data_get_string(data, "vk");
	}
	return s;
}

void save_settings(const Settings &s)
{
	std::string path = config_file("settings.json");
	std::error_code ec;
	std::filesystem::create_directories(fs_path(path).parent_path(), ec);
	OBSDataAutoRelease data = obs_data_create();
	obs_data_set_string(data, "twitch", s.twitch.c_str());
	obs_data_set_string(data, "vk", s.vk.c_str());
	obs_data_save_json_safe(data, path.c_str(), "tmp", "bak");
}

struct Dock {
	const char *id;
	const char *title;
	QWidget *container = nullptr;
	QCefWidget *browser = nullptr;
	std::string url;
};

class Owl {
public:
	void start();
	void stop();
	void showSettings();

private:
	std::string startupScript() const;
	std::string setDataScript() const;
	void applySettings();
	void ensureDock(Dock &d, const std::string &url);
	void syncNow();
	void onDownloaded(const std::string &zip, const std::string &error);
	QString statusText() const;

	QCef *cef = nullptr;
	QCefCookieManager *cookies = nullptr;
	QMainWindow *main = nullptr;
	QTimer *timer = nullptr;
	QLabel *statusLabel = nullptr; // в открытом окне настроек

	Settings settings;
	std::string bundle;
	std::string zipBase64;
	size_t zipSize = 0;
	QDateTime zipTime;
	QString lastError;

	Dock twitch{"owl-smile-twitch", "Owl Smile: Twitch"};
	Dock vk{"owl-smile-vk", "Owl Smile: VK Live"};

	std::thread worker;
	std::atomic<bool> downloading{false};
	bool started = false;
};

Owl owl;

std::string Owl::startupScript() const
{
	// Логин канала уже проверен (только [a-z0-9_]) — его можно вставить в строку как есть
	std::string s = "window.__owlConfig={twitchChannel:\"" + settings.twitch + "\"};\n";
	s += bundle;
	s += "\n;";
	s += setDataScript();
	return s;
}

std::string Owl::setDataScript() const
{
	if (zipBase64.empty())
		return std::string();
	return "window.__owlSetData&&window.__owlSetData('" + zipBase64 + "');";
}

void Owl::ensureDock(Dock &d, const std::string &url)
{
	if (url.empty()) {
		if (d.container) {
			obs_frontend_remove_dock(d.id);
			d.container = nullptr;
			d.browser = nullptr;
		}
		d.url.clear();
		return;
	}
	if (!d.container) {
		d.container = new QWidget();
		d.container->setMinimumSize(220, 200);
		auto *layout = new QVBoxLayout(d.container);
		layout->setContentsMargins(0, 0, 0, 0);
		d.browser = cef->create_widget(d.container, url, cookies);
		if (!d.browser) {
			obs_log(LOG_WARNING, "не удалось создать браузер для дока %s", d.id);
			delete d.container;
			d.container = nullptr;
			return;
		}
		d.browser->setStartupScript(startupScript());
		layout->addWidget(d.browser);
		for (const char *p : LOGIN_POPUPS)
			cef->add_popup_whitelist_url(p, d.container);
		obs_frontend_add_dock_by_id(d.id, d.title, d.container);
	} else if (url != d.url) {
		d.browser->setStartupScript(startupScript());
		d.browser->setURL(url);
	}
	d.url = url;
}

void Owl::applySettings()
{
	ensureDock(twitch, settings.twitch.empty() ? "" : "https://www.twitch.tv/popout/" + settings.twitch + "/chat");
	ensureDock(vk, settings.vk.empty() ? "" : "https://live.vkvideo.ru/" + settings.vk + "/only-chat");
}

void Owl::start()
{
	if (started)
		return;
	main = static_cast<QMainWindow *>(obs_frontend_get_main_window());

	cef = obs_browser_init_panel();
	int version = obs_browser_qcef_version();
	if (!cef || version < 3) {
		obs_log(LOG_ERROR, "нужен модуль браузера OBS (obs-browser, версия панели 3+), есть: %d", version);
		return;
	}
	cef->init_browser();
	cef->wait_for_browser_init();
	cookies = cef->create_cookie_manager(COOKIES, true);

	BPtr<char> bundlePath = obs_module_file("owl-obs.js");
	const char *bundleFile = bundlePath;
	if (!bundleFile || !read_file(bundleFile, bundle)) {
		obs_log(LOG_ERROR, "не найден owl-obs.js в папке плагина");
		return;
	}

	// База с прошлого запуска — чат сразу со смайлами, ещё до сети
	std::string cached;
	if (read_file(config_file("data.zip"), cached) && cached.size() > 4 && cached.compare(0, 2, "PK") == 0) {
		zipBase64 = QByteArray::fromStdString(cached).toBase64().toStdString();
		zipSize = cached.size();
		zipTime = QFileInfo(QString::fromStdString(config_file("data.zip"))).lastModified();
	}

	settings = load_settings();
	applySettings();

	auto *action = static_cast<QAction *>(obs_frontend_add_tools_menu_qaction("Owl Smile…"));
	QObject::connect(action, &QAction::triggered, [] { owl.showSettings(); });

	timer = new QTimer(main);
	QObject::connect(timer, &QTimer::timeout, [] { owl.syncNow(); });
	timer->start(SYNC_MINUTES * 60 * 1000);
	started = true;
	syncNow();
	obs_log(LOG_INFO, "запущен (Twitch: %s, VK Live: %s)", settings.twitch.empty() ? "—" : settings.twitch.c_str(),
		settings.vk.empty() ? "—" : settings.vk.c_str());
}

void Owl::stop()
{
	if (timer)
		timer->stop();
	if (worker.joinable())
		worker.join();
	if (cookies)
		cookies->FlushStore();
}

void Owl::syncNow()
{
	if (downloading.exchange(true))
		return;
	if (worker.joinable())
		worker.join();
	worker = std::thread([] {
		std::string body, error;
		bool ok = http_get(DATA_URL, body, error, MAX_ZIP_BYTES);
		if (ok && (body.size() < 4 || body.compare(0, 2, "PK") != 0)) {
			ok = false;
			error = "вместо архива пришло что-то другое";
		}
		if (!ok)
			body.clear();
		QMetaObject::invokeMethod(
			qApp, [body = std::move(body), error] { owl.onDownloaded(body, error); }, Qt::QueuedConnection);
	});
}

void Owl::onDownloaded(const std::string &zip, const std::string &error)
{
	downloading = false;
	if (zip.empty()) {
		lastError = QString::fromStdString(error);
		obs_log(LOG_WARNING, "база не скачалась: %s", error.c_str());
	} else {
		lastError.clear();
		std::string b64 = QByteArray::fromStdString(zip).toBase64().toStdString();
		zipTime = QDateTime::currentDateTime();
		if (b64 != zipBase64) {
			zipBase64 = std::move(b64);
			zipSize = zip.size();
			write_file(config_file("data.zip"), zip);
			// Открытые чаты получают базу без перезагрузки, новые загрузки — через startup-скрипт
			std::string update = setDataScript();
			for (Dock *d : {&twitch, &vk}) {
				if (!d->browser)
					continue;
				d->browser->setStartupScript(startupScript());
				d->browser->executeJavaScript(update);
			}
			obs_log(LOG_INFO, "база обновлена (%zu байт)", zip.size());
		}
	}
	if (statusLabel)
		statusLabel->setText(statusText());
}

QString Owl::statusText() const
{
	QString s = zipSize ? tr8("База смайлов: %1 КБ, проверена %2")
				      .arg(QString::number(zipSize / 1024))
				      .arg(zipTime.toString(tr8("dd.MM HH:mm")))
			    : tr8("База смайлов ещё не скачана");
	if (downloading)
		s += tr8(" · обновляю…");
	if (!lastError.isEmpty())
		s += tr8("\nПоследняя попытка не удалась: ") + lastError;
	return s;
}

void Owl::showSettings()
{
	QDialog dlg(main);
	dlg.setWindowTitle(tr8("Owl Smile"));
	auto *root = new QVBoxLayout(&dlg);

	auto *intro = new QLabel(tr8("Доки с чатами Twitch и VK Live со смайлами, иконками и эффектами ников Owl Smile.\n"
				     "Войдите в аккаунт прямо в доке — один раз, вход сохранится."));
	intro->setWordWrap(true);
	root->addWidget(intro);

	auto *form = new QFormLayout();
	auto *twitchEdit = new QLineEdit(QString::fromStdString(settings.twitch));
	twitchEdit->setPlaceholderText(tr8("логин канала, например owl_streamer"));
	auto *vkEdit = new QLineEdit(QString::fromStdString(settings.vk));
	vkEdit->setPlaceholderText(tr8("адрес канала: live.vkvideo.ru/…"));
	form->addRow(tr8("Twitch"), twitchEdit);
	form->addRow(tr8("VK Live"), vkEdit);
	root->addLayout(form);

	auto *hint = new QLabel(tr8("Пустое поле — док не нужен. Док открывается в меню «Доки»."));
	hint->setWordWrap(true);
	hint->setStyleSheet(tr8("color: gray"));
	root->addWidget(hint);

	auto *status = new QLabel(statusText());
	status->setWordWrap(true);
	statusLabel = status;
	auto *refresh = new QPushButton(tr8("Обновить смайлы"));
	QObject::connect(refresh, &QPushButton::clicked, [status] {
		owl.syncNow();
		status->setText(owl.statusText());
	});
	root->addWidget(status);
	root->addWidget(refresh);

	auto *error = new QLabel();
	error->setStyleSheet(tr8("color: #e5534b"));
	error->setWordWrap(true);
	root->addWidget(error);

	auto *buttons = new QDialogButtonBox(QDialogButtonBox::Ok | QDialogButtonBox::Cancel);
	root->addWidget(buttons);
	QObject::connect(buttons, &QDialogButtonBox::rejected, &dlg, &QDialog::reject);
	QObject::connect(buttons, &QDialogButtonBox::accepted, [&] {
		Settings next;
		next.twitch = twitch_login(twitchEdit->text());
		next.vk = vk_channel(vkEdit->text());
		if (!twitchEdit->text().trimmed().isEmpty() && next.twitch.empty()) {
			error->setText(tr8("Twitch: нужен логин канала — латиница, цифры и _"));
			return;
		}
		if (!vkEdit->text().trimmed().isEmpty() && next.vk.empty()) {
			error->setText(tr8("VK Live: нужен адрес канала, например live.vkvideo.ru/owl_streamer"));
			return;
		}
		dlg.accept();
		bool twitchChanged = next.twitch != settings.twitch;
		settings = next;
		save_settings(settings);
		// Новый Twitch-канал нужен и чату VK (смайлы BetterTTV) — перезапускаем страницы со свежим скриптом
		if (twitchChanged)
			for (Dock *d : {&twitch, &vk})
				if (d->browser)
					d->browser->setStartupScript(startupScript());
		applySettings();
		if (twitchChanged && vk.browser)
			vk.browser->reloadPage();
	});

	dlg.exec();
	statusLabel = nullptr;
}

} // namespace

void owl_start()
{
	owl.start();
}

void owl_stop()
{
	owl.stop();
}
