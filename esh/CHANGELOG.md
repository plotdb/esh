# CHANGELOG

## master

 - init: 自 poc-shelljs 整理為正式套件結構
   - src/(core/base/bundle-entry/node-entry + shims)、tools/build.mjs
   - dist: esh.js(ESM)+ esh.iife.js(window.esh)
   - web/: fedev 慣例(pug demo 消費 dist 成品, 不依賴 vite)
   - vite 保留為迴歸測試頁 dev harness(m2/m25/terminal)
