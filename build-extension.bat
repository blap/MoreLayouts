@echo off
REM MoreLayouts Thunderbird Extension Build Script
REM This script packages the extension into an XPI file for distribution

set SRC_DIR=src
set OUTPUT_DIR=dist
set EXTENSION_NAME=morelayouts-thunderbird
set VERSION=7.3

echo Building MoreLayouts Thunderbird Extension...

REM Create output directory if it doesn't exist
if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"

REM Remove any existing XPI file
if exist "%OUTPUT_DIR%\%EXTENSION_NAME%-%VERSION%.xpi" del "%OUTPUT_DIR%\%EXTENSION_NAME%-%VERSION%.xpi"

REM Create temporary directory for packaging
if exist "%OUTPUT_DIR%\temp" rd /s /q "%OUTPUT_DIR%\temp"
mkdir "%OUTPUT_DIR%\temp"

REM Copy all source files to temporary directory
echo Copying files to temporary directory...
copy "%SRC_DIR%\manifest.json" "%OUTPUT_DIR%\temp\" >nul
copy "%SRC_DIR%\background.js" "%OUTPUT_DIR%\temp\" >nul
copy "%SRC_DIR%\experiments.js" "%OUTPUT_DIR%\temp\" >nul
copy "%SRC_DIR%\schema.json" "%OUTPUT_DIR%\temp\" >nul
copy "%SRC_DIR%\LICENSE.txt" "%OUTPUT_DIR%\temp\" >nul

REM Copy directories
xcopy "%SRC_DIR%\content" "%OUTPUT_DIR%\temp\content\" /E /I /Q >nul
xcopy "%SRC_DIR%\skin" "%OUTPUT_DIR%\temp\skin\" /E /I /Q >nul
xcopy "%SRC_DIR%\_locales" "%OUTPUT_DIR%\temp\_locales\" /E /I /Q >nul

REM Create XPI file (ZIP format with .xpi extension)
echo Creating XPI file...
cd "%OUTPUT_DIR%\temp"
tar -a -cf "..\%EXTENSION_NAME%-%VERSION%.xpi" *
cd ..\..

REM Clean up temporary directory
rd /s /q "%OUTPUT_DIR%\temp"

echo.
echo Build completed successfully!
echo Extension package created: %OUTPUT_DIR%\%EXTENSION_NAME%-%VERSION%.xpi