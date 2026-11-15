#include "http-get.hpp"

#include <windows.h>
#include <winhttp.h>

#include <memory>
#include <vector>

namespace {

std::wstring widen(const std::string &s)
{
	if (s.empty())
		return {};
	int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
	std::wstring out(n, L'\0');
	MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), out.data(), n);
	return out;
}

struct HandleCloser {
	void operator()(HINTERNET h) const
	{
		if (h)
			WinHttpCloseHandle(h);
	}
};
using Handle = std::unique_ptr<void, HandleCloser>;

std::string last_error(const char *what)
{
	return std::string(what) + " (код " + std::to_string(GetLastError()) + ")";
}

} // namespace

bool http_get(const std::string &url, std::string &body, std::string &error, size_t max_bytes)
{
	std::wstring wurl = widen(url);
	// Компоненты возвращаются указателями внутрь wurl (длина -1 и указатель null)
	URL_COMPONENTS parts = {};
	parts.dwStructSize = sizeof(parts);
	parts.dwHostNameLength = (DWORD)-1;
	parts.dwUrlPathLength = (DWORD)-1;
	parts.dwExtraInfoLength = (DWORD)-1;
	if (!WinHttpCrackUrl(wurl.c_str(), 0, 0, &parts)) {
		error = last_error("неверный адрес");
		return false;
	}
	std::wstring host(parts.lpszHostName, parts.dwHostNameLength);
	// Путь вместе с query (?branch=…)
	std::wstring path = std::wstring(parts.lpszUrlPath, parts.dwUrlPathLength) +
			    std::wstring(parts.lpszExtraInfo ? parts.lpszExtraInfo : L"", parts.dwExtraInfoLength);

	Handle session(WinHttpOpen(L"owl-smile-obs", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_NO_PROXY_NAME,
				   WINHTTP_NO_PROXY_BYPASS, 0));
	if (!session) {
		error = last_error("WinHttpOpen");
		return false;
	}
	WinHttpSetTimeouts(session.get(), 15000, 15000, 30000, 60000);

	Handle connect(WinHttpConnect(session.get(), host.c_str(), parts.nPort, 0));
	if (!connect) {
		error = last_error("нет соединения");
		return false;
	}
	DWORD flags = parts.nScheme == INTERNET_SCHEME_HTTPS ? WINHTTP_FLAG_SECURE : 0;
	Handle request(WinHttpOpenRequest(connect.get(), L"GET", path.c_str(), nullptr, WINHTTP_NO_REFERER,
					  WINHTTP_DEFAULT_ACCEPT_TYPES, flags));
	if (!request) {
		error = last_error("WinHttpOpenRequest");
		return false;
	}
	if (!WinHttpSendRequest(request.get(), WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0) ||
	    !WinHttpReceiveResponse(request.get(), nullptr)) {
		error = last_error("сервер не ответил");
		return false;
	}

	DWORD status = 0;
	DWORD size = sizeof(status);
	WinHttpQueryHeaders(request.get(), WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX,
			    &status, &size, WINHTTP_NO_HEADER_INDEX);
	if (status != 200) {
		error = "сервер ответил " + std::to_string(status);
		return false;
	}

	body.clear();
	std::vector<char> buf(64 * 1024);
	for (;;) {
		DWORD read = 0;
		if (!WinHttpReadData(request.get(), buf.data(), (DWORD)buf.size(), &read)) {
			error = last_error("обрыв при скачивании");
			return false;
		}
		if (read == 0)
			break;
		body.append(buf.data(), read);
		if (body.size() > max_bytes) {
			error = "слишком большой ответ";
			return false;
		}
	}
	return true;
}
