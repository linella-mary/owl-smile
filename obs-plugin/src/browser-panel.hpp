/*
 * Интерфейс доков с браузером из obs-browser (panel/browser-panel.hpp, версия панели 3).
 * Объявления повторяют оригинал один в один: плагин вызывает виртуальные методы объектов,
 * созданных obs-browser, поэтому порядок методов менять нельзя.
 * https://github.com/obsproject/obs-browser/blob/master/panel/browser-panel.hpp (GPL-2.0)
 *
 * Q_OBJECT и сигналы оригинала опущены: они не добавляют новых виртуальных методов
 * (metaObject/qt_metacast/qt_metacall переопределяют методы QObject), и плагин их не использует.
 */
#pragma once

#include <obs-module.h>
#include <util/platform.h>
#include <util/util.hpp>

#include <QWidget>

#include <functional>
#include <string>

struct QCefCookieManager {
	virtual ~QCefCookieManager() {}

	virtual bool DeleteCookies(const std::string &url, const std::string &name) = 0;
	virtual bool SetStoragePath(const std::string &storage_path, bool persist_session_cookies = false) = 0;
	virtual bool FlushStore() = 0;

	typedef std::function<void(bool)> cookie_exists_cb;

	virtual void CheckForCookie(const std::string &site, const std::string &cookie, cookie_exists_cb callback) = 0;
};

class QCefWidget : public QWidget {
protected:
	inline QCefWidget(QWidget *parent) : QWidget(parent) {}

public:
	virtual void setURL(const std::string &url) = 0;
	virtual void setStartupScript(const std::string &script) = 0;
	virtual void allowAllPopups(bool allow) = 0;
	virtual void closeBrowser() = 0;
	virtual void reloadPage() = 0;
	virtual bool zoomPage(int direction) = 0;
	virtual void executeJavaScript(const std::string &script) = 0;
};

struct QCef {
	virtual ~QCef() {}

	virtual bool init_browser(void) = 0;
	virtual bool initialized(void) = 0;
	virtual bool wait_for_browser_init(void) = 0;

	virtual QCefWidget *create_widget(QWidget *parent, const std::string &url,
					  QCefCookieManager *cookie_manager = nullptr) = 0;

	virtual QCefCookieManager *create_cookie_manager(const std::string &storage_path,
							 bool persist_session_cookies = false) = 0;

	virtual BPtr<char> get_cookie_path(const std::string &storage_path) = 0;

	virtual void add_popup_whitelist_url(const std::string &url, QObject *obj) = 0;
	virtual void add_force_popup_url(const std::string &url, QObject *obj) = 0;
};

static inline void *get_browser_lib()
{
	obs_module_t *browserModule = obs_get_module("obs-browser");
	if (!browserModule)
		return nullptr;
	return obs_get_module_lib(browserModule);
}

static inline QCef *obs_browser_init_panel(void)
{
	void *lib = get_browser_lib();
	if (!lib)
		return nullptr;
	auto create_qcef = (QCef * (*)(void)) os_dlsym(lib, "obs_browser_create_qcef");
	return create_qcef ? create_qcef() : nullptr;
}

static inline int obs_browser_qcef_version(void)
{
	void *lib = get_browser_lib();
	if (!lib)
		return 0;
	auto qcef_version = (int (*)(void))os_dlsym(lib, "obs_browser_qcef_version_export");
	return qcef_version ? qcef_version() : 0;
}
