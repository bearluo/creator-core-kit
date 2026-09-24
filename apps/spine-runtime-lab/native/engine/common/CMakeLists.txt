enable_language(C ASM)
set(DEVELOPMENT_TEAM    ""  CACHE STRING "APPLE Developtment Team")
set(RES_DIR             ""  CACHE STRING "Resource path")
set(COCOS_X_PATH        ""  CACHE STRING "Path to engine/native/")

set(TARGET_OSX_VERSION "10.14" CACHE STRING "Target MacOSX version" FORCE)
set(TARGET_IOS_VERSION "11.0"  CACHE STRING "Target iOS version" FORCE)

set(CMAKE_CXX_STANDARD 17)
option(CC_DEBUG_FORCE           "Force enable CC_DEBUG in release mode" OFF)
option(USE_SE_V8                "Use V8 JavaScript Engine"              ON)
option(USE_SE_JSVM              "Use JSVM JavaScript Engine"            OFF)
option(USE_SE_JSC               "Use JavaScriptCore on MacOSX/iOS"      OFF)
option(USE_V8_DEBUGGER          "Compile v8 inspector ws server"        ON)
option(USE_V8_DEBUGGER_FORCE    "Force enable debugger in release mode" OFF)
option(USE_SOCKET               "Enable WebSocket & SocketIO"           ON)
option(USE_AUDIO                "Enable Audio"                          ON)     #Enable AudioEngine
option(USE_EDIT_BOX             "Enable EditBox"                        ON)
option(USE_VIDEO                "Enable VideoPlayer Component"          ON)
option(USE_WEBVIEW              "Enable WebView Component"              ON)
option(USE_MIDDLEWARE           "Enable Middleware"                     ON)
option(USE_DRAGONBONES          "Enable Dragonbones"                    ON)
option(USE_SPINE_3_8            "Enable Spine 3.8"                      ON)
option(USE_SPINE_4_2            "Enable Spine 4.2"                      OFF)
option(USE_WEBSOCKET_SERVER     "Enable WebSocket Server"               OFF)
option(USE_JOB_SYSTEM_TASKFLOW  "Use taskflow as job system backend"    OFF)
option(USE_JOB_SYSTEM_TBB       "Use tbb as job system backend"         OFF)
option(USE_PHYSICS_PHYSX        "Use PhysX Physics"                     ON)
option(USE_OCCLUSION_QUERY      "Use Occlusion Query"                   ON)
option(USE_DEBUG_RENDERER       "Use Debug Renderer"                    ON)
option(USE_GEOMETRY_RENDERER    "Use Geometry Renderer"                 ON)
option(USE_WEBP                 "Use Webp"                              ON)

if(NOT RES_DIR)
    message(FATAL_ERROR "RES_DIR is not set!")
endif()

include(${RES_DIR}/proj/cfg.cmake)

if(EXISTS ${CMAKE_CURRENT_LIST_DIR}/localCfg.cmake)
    include(${CMAKE_CURRENT_LIST_DIR}/localCfg.cmake)
endif()

if(NOT COCOS_X_PATH)
    message(FATAL_ERROR "COCOS_X_PATH is not set!")
endif()

if(USE_XR OR USE_AR_MODULE)
    include(${CMAKE_CURRENT_LIST_DIR}/xr.cmake)
endif()

include(${COCOS_X_PATH}/CMakeLists.txt)

# 可选：VAT UI 的 MeshBuffer 按需上传（引擎补丁，见 Classes/engine-patches/UIMeshBuffer.cpp 头注释）。
# 默认关 = 原版引擎。JS 侧的标记位对原版无害，所以开关只在这里，不用改脚本。
# 开：本机 localCfg.cmake 里 set(CCK_VAT_UI_STATIC_VB ON)；整个项目都开就改下面的默认值。
# 用普通变量不用 option()：option 进 CMake cache，关掉后旧值还粘在 .cxx 缓存里。
if(NOT DEFINED CCK_VAT_UI_STATIC_VB)
    set(CCK_VAT_UI_STATIC_VB OFF)
endif()
if(CCK_VAT_UI_STATIC_VB)
    get_target_property(CCK_ENGINE_SOURCES ${ENGINE_NAME} SOURCES)
    list(FILTER CCK_ENGINE_SOURCES EXCLUDE REGEX "2d/renderer/UIMeshBuffer[.]cpp$")
    list(APPEND CCK_ENGINE_SOURCES ${CMAKE_CURRENT_LIST_DIR}/Classes/engine-patches/UIMeshBuffer.cpp)
    set_property(TARGET ${ENGINE_NAME} PROPERTY SOURCES ${CCK_ENGINE_SOURCES})
    message(STATUS "CCK_VAT_UI_STATIC_VB: UIMeshBuffer.cpp patched")
endif()

list(APPEND CC_COMMON_SOURCES
    ${CMAKE_CURRENT_LIST_DIR}/Classes/Game.h
    ${CMAKE_CURRENT_LIST_DIR}/Classes/Game.cpp
)
