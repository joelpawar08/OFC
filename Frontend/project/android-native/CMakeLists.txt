cmake_minimum_required(VERSION 3.4.1)

add_library(native_llm SHARED native_llm.cpp)

find_library(log-lib log)

target_link_libraries(native_llm ${log-lib})
