#pragma once

#include <string>

/* GET по HTTPS (WinHTTP). Возвращает тело ответа; при ошибке — false и текст в `error`. */
bool http_get(const std::string &url, std::string &body, std::string &error, size_t max_bytes);

/* Прервать идущие запросы и отказывать новым (при выходе из OBS). Можно звать из любого потока. */
void http_cancel_all();
