# difgraph

`difgraph` is a local-only Git commit graph viewer. It shows the most recent 100 commits reachable from a selected local branch and can start and embed [difit](https://github.com/yoshiko-pg/difit) for any loaded commit.

`difgraph` 是一个只在本机运行的 Git 提交图查看器。它展示所选本地分支可达的最近 100 个提交，并可为任一已加载提交启动和嵌入 [difit](https://github.com/yoshiko-pg/difit)。

## Usage / 使用

```bash
npm start -- /path/to/repository
```

```bash
difgraph [path] [--host 127.0.0.1] [--port 4173] [--locale en|zh-CN]
```

The repository path defaults to the current directory. Branch selection changes the view only and never runs `git checkout`. The service accepts loopback hosts only and opens a browser by default.

仓库路径默认为当前目录。分支切换仅影响视图，不会执行 `git checkout`。服务仅接受 loopback 地址；默认启动后会打开浏览器。

## Language / 语言

The page supports English and Simplified Chinese. Use `--locale`, the `locale` query parameter, or the in-page language switcher. The switcher stores `codex_suite_locale` and shares that preference across suite viewers. Missing translations fall back to English.

页面支持英文和简体中文。可使用 `--locale`、`locale` 查询参数或页面语言切换控件。切换后会保存 `codex_suite_locale`，并与套件内其他 Viewer 共享。缺失翻译会回退英文。

## Tests / 测试

```bash
npm test
```

When difit is not found in `PATH`, difgraph uses the `difit` dependency installed in the suite root. Only one embedded difit instance is kept at a time, and it is stopped when difgraph exits.

当 `PATH` 中没有 `difit` 时，difgraph 会使用套件根依赖中的 `difit`。同一时间只保留一个 difit 实例，退出 difgraph 时会一并清理。
