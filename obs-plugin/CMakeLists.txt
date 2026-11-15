# Owl Smile для OBS. Собирается поверх obs-plugintemplate (см. .github/workflows/obs-plugin.yml):
# шаблон даёт cmake/, скрипты сборки и src/plugin-support.*, отсюда — исходники плагина.
cmake_minimum_required(VERSION 3.28...3.30)

include("${CMAKE_CURRENT_SOURCE_DIR}/cmake/common/bootstrap.cmake" NO_POLICY_SCOPE)

project(${_name} VERSION ${_version})

# Доки и меню нужны всегда — не опции, как в шаблоне
set(ENABLE_FRONTEND_API ON CACHE BOOL "Use obs-frontend-api for UI functionality" FORCE)
set(ENABLE_QT ON CACHE BOOL "Use Qt functionality" FORCE)

include(compilerconfig)
include(defaults)
include(helpers)

# CI-пресет шаблона превращает предупреждения в ошибки; сборка на GitHub — единственная проверка
# компилятором, поэтому предупреждения оставляем предупреждениями (их видно в логе)
set(CMAKE_COMPILE_WARNING_AS_ERROR OFF)

add_library(${CMAKE_PROJECT_NAME} MODULE)

find_package(libobs REQUIRED)
target_link_libraries(${CMAKE_PROJECT_NAME} PRIVATE OBS::libobs)

find_package(obs-frontend-api REQUIRED)
target_link_libraries(${CMAKE_PROJECT_NAME} PRIVATE OBS::obs-frontend-api)

find_package(Qt6 COMPONENTS Widgets Core REQUIRED)
target_link_libraries(${CMAKE_PROJECT_NAME} PRIVATE Qt6::Core Qt6::Widgets)
set_target_properties(
  ${CMAKE_PROJECT_NAME}
  PROPERTIES AUTOMOC ON AUTOUIC ON AUTORCC ON CXX_STANDARD 17 CXX_STANDARD_REQUIRED ON
)

target_sources(${CMAKE_PROJECT_NAME} PRIVATE src/plugin-main.cpp src/owl.cpp src/owl.hpp src/browser-panel.hpp src/http-get.hpp)

if(OS_WINDOWS)
  target_sources(${CMAKE_PROJECT_NAME} PRIVATE src/http-get-win.cpp)
  target_link_libraries(${CMAKE_PROJECT_NAME} PRIVATE winhttp)
  # Русские строки в исходниках — UTF-8
  target_compile_options(${CMAKE_PROJECT_NAME} PRIVATE /utf-8)
endif()

set_target_properties_plugin(${CMAKE_PROJECT_NAME} PROPERTIES OUTPUT_NAME ${_name})
