#pragma once

#include <string>

/* GET по HTTPS (WinHTTP). Возвращает тело ответа; при ошибке — false и текст в `error`. */
bool http_get(const std::string &url, std::string &body, std::string &error, size_t max_bytes);
