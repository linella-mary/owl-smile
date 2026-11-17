# План: вход в VK Live и Twitch из доков OBS

Статус: **сделано 17.11.2026 (шаги 1–5), не закоммичено. Осталось: проверка в настоящем OBS у тестера (раздел «Проверка», п. 3).** Этот файл самодостаточен: новой сессии достаточно прочитать его и выполнить раздел «Что сделать». После выпуска файл удалить.

## Жалоба

Тестер (Вячеслав, OBS 33.0.0-rc3, Windows) нажимает «Авторизуйтесь» в доке «Owl Smile: VK Live». Его слова: «открывается окно браузера уже открытого, там предлагает вход в аккаунт. я выбираю нужный. и — белый экран на следующей загрузке». Док так и не входит. Вход в доке VK Live до конца никто раньше не проверял.

## Причина (проверено по исходникам obs-browser, ветка master)

Плагин перечисляет страницы входа в `LOGIN_POPUPS` ([obs-plugin/src/owl.cpp:50-53](obs-plugin/src/owl.cpp#L50-L53)) и передаёт их в `cef->add_popup_whitelist_url` ([owl.cpp:232-233](obs-plugin/src/owl.cpp#L232-L233)), рассчитывая на совпадение по началу адреса. obs-browser сравнивает адрес **целиком**:

```cpp
// obs-browser/panel/browser-panel-client.cpp, QCefBrowserClient::OnBeforePopup
if (allowAllPopups) { windowInfo.parent_window = hwnd; return false; }   // окно внутри OBS
...
if (astrcmpi(info.url.c_str(), str_url.c_str()) == 0) { ...; return false; }  // точное равенство
...
QDesktopServices::openUrl(url);   // всё остальное — в обычный браузер
return true;                      // а всплывающее окно отменяется
```

Настоящий адрес входа всегда длиннее записи из списка, поэтому список не срабатывает никогда. Окно входа отменяется и открывается в обычном браузере. Там последняя страница входа должна передать результат окну-открывателю и закрыться; открывателя нет — страница белая, док ничего не получает. Сеть ни при чём. С Twitch будет то же самое.

Ещё три факта из тех же исходников, на них опирается план:

1. Флаг `allowAllPopups` клиент копирует один раз, в `QCefWidgetInternal::Init` (`new QCefBrowserClient(this, script, allowAllPopups_)`). `Init` вызывается при первом показе виджета. Значит, `allowAllPopups(true)` надо вызвать **до показа**.
2. Всплывающее окно получает тот же клиент и тот же request context, что и док: cookies общие, `window.opener` сохраняется, стартовый скрипт (`widget->script`, то есть наш бандл) выполняется в главном кадре окна на каждом `OnLoadEnd`.
3. В `OnLoadStart` главного кадра **любого** окна, включая всплывающие, obs-browser выполняет
   `window.close = () => console.log('OBS browser docks cannot be closed using JavaScript.');`
   Поэтому окно входа само не закроется и повиснет белым уже внутри OBS, если это не починить.

## Twitch: то же самое

Проверено по коду: док Twitch создаётся той же `Owl::ensureDock`, его записи в списке (`https://www.twitch.tv/login`, `https://passport.twitch.tv`) сравниваются так же целиком и так же не срабатывают. Правка из шага 1 чинит оба дока сразу, отдельной правки для Twitch не нужно. `onChatSite` в шаге 2 уже включает `twitch.tv` с поддоменами.

Не проверено (нужен настоящий OBS, поиском не подтвердилось):

- **Как именно чат Twitch открывает вход** — всплывающим окном или переходом внутри дока. Всплывающее окно после правки откроется в OBS. Если это переход внутри дока, он работал и раньше, но после входа Twitch может оставить док на главной странице, а не на чате: `ensureDock` заново открывает адрес чата только при смене настроек. Тогда следующей правкой добавить в окно «Сервис → Owl Smile…» кнопку «Вернуть чаты» (`d.browser->setURL(d.url)` для обоих доков). Сейчас не делать.
- **Пустит ли Twitch вход во встроенном браузере.** На форуме разработчиков Twitch пишут, что вход в «нестандартных» браузерах (CEF) Twitch может отклонять. Собственный вход OBS в Twitch идёт через тот же CEF и работает, так что скорее всего пустит. Если откажет — это ограничение Twitch, плагином не лечится; сообщить пользователю, а не подбирать обходы.
- **Закроется ли окно входа Twitch само.** Страница входа Twitch не пустая, поэтому автозакрытие по пустой странице её не тронет; сработает только возвращённый `window.close`, если Twitch его вызывает. Иначе окно закрывают вручную и жмут «Обновить» в доке.

## Решение пользователя

На вопрос «какие окна открывать внутри OBS» выбран вариант **«Все окна»** (как в обычных доках OBS, `allowAllPopups(true)`), а не «только вход». Ссылки из чата тоже будут открываться окном OBS — это принято осознанно. Не переделывать на выборочный вариант.

## Что сделать

### 1. [obs-plugin/src/owl.cpp](obs-plugin/src/owl.cpp)

- В `Owl::ensureDock`, сразу после проверки `if (!d.browser) {...}` и до `layout->addWidget` / `obs_frontend_add_dock_by_id`, добавить `d.browser->allowAllPopups(true);` с комментарием: окна входа должны открываться внутри OBS, иначе вход окажется в обычном браузере; вызов до показа, потому что obs-browser читает флаг один раз.
- Удалить массив `LOGIN_POPUPS` с комментарием над ним и цикл `for (const char *p : LOGIN_POPUPS) cef->add_popup_whitelist_url(...)`.
- [browser-panel.hpp](obs-plugin/src/browser-panel.hpp) не менять: `allowAllPopups` там уже объявлен, порядок виртуальных методов совпадает с оригиналом.

### 2. Новый файл `extension/src/obs/popup.ts`

```ts
/**
 * Окна, открытые из дока (вход VK/Twitch, ссылки). obs-browser в начале загрузки каждой страницы
 * подменяет window.close пустышкой — и в доке, и во всплывающих окнах. Окно входа после успеха
 * зовёт close(), ничего не происходит, и оно висит белым. Здесь close возвращается окнам,
 * у которых есть opener; сам док (opener === null) закрыть по-прежнему нельзя.
 */
const BLANK_CLOSE_MS = 3000;

function onChatSite(host: string): boolean {
  return ['twitch.tv', 'vkvideo.ru'].some((d) => host === d || host.endsWith('.' + d));
}

function isBlank(): boolean {
  const body = document.body;
  if (!body) return true;
  if (body.innerText.trim()) return false;
  return !body.querySelector('img, video, canvas, svg, iframe:not([data-owl]), input, button');
}

export function fixPopupClose(): void {
  const w = window as unknown as { __owlPopupFixed?: boolean };
  if (!window.opener || w.__owlPopupFixed) return;
  w.__owlPopupFixed = true;
  const close = (): void => {
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.dataset.owl = 'close';
    document.documentElement.append(frame);
    // close из свежего окна — настоящий; вызываем его для своего окна
    frame.contentWindow!.close.call(window);
  };
  window.close = close;
  // Страница вернулась на сайт чата и осталась пустой: она уже вызвала пустышку close до нас
  if (onChatSite(location.hostname)) setTimeout(() => { if (isBlank()) close(); }, BLANK_CLOSE_MS);
}
```

Это набросок: довести до прохождения `npm run compile` и проверки из шага 4.

### 3. [extension/src/obs/inject.ts](extension/src/obs/inject.ts)

Импортировать `fixPopupClose` и вызвать его **до** `main()` (на верхнем уровне модуля): он нужен на любом адресе, а `main()` выходит раньше, если для адреса нет адаптера. Остальное поведение бандла не менять.

### 4. Проверка в Chromium: `extension/scripts/e2e-obs.ts` + скрипт `"e2e:obs": "tsx scripts/e2e-obs.ts"` в [extension/package.json](extension/package.json)

Отдельный короткий сценарий на Playwright по образцу [scripts/e2e.ts](extension/scripts/e2e.ts) (взять оттуда `check`, `waitFor`, завершение через `process.exitCode`). Расширение в браузер не грузить.

- Собрать бандл: `execSync('npx vite build --config vite.obs.config.ts')`, прочитать `.output/obs/owl-obs.js`.
- `chromium.launch({ channel: 'chromium', headless: true })`, один `context`.
- Изобразить obs-browser:
  - `context.addInitScript`: `if (window === window.top) window.close = () => console.log('OBS browser docks cannot be closed using JavaScript.');`. Проверка `window === window.top` обязательна: obs-browser трогает только главный кадр, а init-скрипт Playwright выполняется и в `iframe` — без проверки он сломает сам приём с `iframe`.
  - для каждой страницы контекста (`context.on('page', ...)` и первая страница) на событие `load` выполнять `page.evaluate(бандл)` — как `OnLoadEnd`.
- Подставные страницы через `context.route`:
  - док `https://live.vkvideo.ru/chan/only-chat`: кнопка с `window.open('https://id.vk.com/auth')` и слушатель `message`, который пишет полученное в `window.__got`;
  - `https://id.vk.com/auth`: ссылка или скрипт перехода на `https://live.vkvideo.ru/app/oauth_redirect?code=1`;
  - `https://live.vkvideo.ru/app/oauth_redirect*`: пустая страница со встроенным `<script>opener.postMessage('done','*'); window.close()</script>`;
  - `https://live.vkvideo.ru/other`: страница с текстом (обычная ссылка, открытая в окне).
- Проверить:
  1. после нажатия кнопки окно входа открылось, дошло до пустой страницы и **закрылось само** (`popup.waitForEvent('close')`), док получил `'done'`;
  2. окно на `…/other` с содержимым через 4 секунды всё ещё открыто;
  3. в окне с содержимым поздний `window.close()` (через `popup.evaluate`) закрывает окно;
  4. страница дока не закрылась и `window.close()` в ней по-прежнему пустышка;
  5. то же на адресах Twitch: док `https://www.twitch.tv/popout/chan/chat` открывает `https://www.twitch.tv/login` (страница с формой, не пустая) — окно через 4 секунды открыто, а после `window.close()` из страницы закрывается.

### 5. [README.md:93](README.md#L93), шаг 4 раздела «Owl Smile в OBS»

Дописать простыми словами: вход открывается отдельным окном OBS и закрывается сам; ссылки из чата тоже открываются окном OBS; если после входа док всё ещё просит авторизоваться — правый щелчок по доку → «Обновить».

## Проверка

1. В `extension/`: `npm run compile`, `npm test`, `npm run build:obs`, `npm run e2e:obs` — всё зелёное.
2. C++ локально не собрать: OBS и его SDK на этой машине нет, компилятор — только сборка на GitHub ([.github/workflows/obs-plugin.yml](.github/workflows/obs-plugin.yml)). Тестовая сборка без релиза — `npm run obs:plugin` в `extension/`; она собирает **последний коммит** и отправляет его на GitHub, поэтому запускать только после разрешения пользователя.
3. В настоящем OBS (у тестера, на новой сборке): «Авторизуйтесь» в доке VK Live открывает окно OBS, а не обычный браузер; после входа окно закрывается само и в доке появляется поле ввода. Для дока Twitch проверить отдельно и записать ответы на три вопроса из раздела «Twitch: то же самое»: вход открылся окном или внутри дока; пустил ли Twitch вход; закрылось ли окно само и остался ли док на чате.

## Чего план не гарантирует

- Настоящий вход VK отсюда не проверить. Если после входа док не обновится сам — следующей правкой добавить перезагрузку дока после закрытия окна входа. Пока запасной путь — «Обновить» из README.
- Порог `BLANK_CLOSE_MS = 3000` подобран без живого VK. Если окно закроется раньше времени (вход сорвётся) или не закроется — править по итогам проверки у тестера.
- В окне OBS нет сохранённого входа VK из обычного браузера: тестеру придётся один раз ввести номер и подтверждение.

## Правила работы в этом проекте

- Коммитить, отправлять и выпускать **только по команде пользователя «коммитим»** — через скилл `gitflic-push` (коммит + push на GitFlic + релиз). Это исправление: версия 0.6.0 → 0.6.1.
- `git` в этой папке падает с «dubious ownership». Глобальный конфиг не менять; вызывать как скрипты проекта: `git -c safe.directory=D:/_DEV/owl_smile ...`.
- Комментарии в коде и тексты для пользователей — по-русски, как в остальном проекте.
