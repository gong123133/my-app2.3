# 维护说明（换人 / 换 AI 继续改）

这个 App 没有框架、没有编译步骤，全部是可读的 HTML/CSS/JS。只要保留本文件夹，任何人都能继续改。

## 1. 文件分工

| 文件 | 改什么 |
|---|---|
| `index.html` | 页面结构、按钮、弹层容器 |
| `style.css` | 颜色、字号、布局、打印样式 |
| `app.js` | 全部交互：名录、记录、编号、语音、统计、PDF、设置 |
| `taxonomy-data.js` | 内置名录数据（自动生成，约 1 MB，不建议手改） |
| `分类名录_v2.csv` | 名录的 CSV 备份，可用 Excel 打开/编辑 |
| `sw.js` | 离线缓存；每次发版把 `CACHE` 版本号 +1 |
| `manifest.webmanifest` | 安装到主屏幕的配置 |
| `CHANGELOG.md` | 每个版本改了什么 |
| `README.md` | 给使用者看的说明 |

## 2. 最常见修改位置

### 加/改名录
- 日常：设置 → 分类名录 → 粘贴/选择 CSV（8 列：`目,科中文,科拉丁,属中文,属拉丁,种中文,种拉丁,别名`）。
- 批量：改 `分类名录_v2.csv` 后导入；或改 `tools/build_taxonomy.py` 的源文件路径后重新生成 `taxonomy-data.js`。
- 不要在 `app.js` 里加名录；名录与逻辑是分开的。
- `目` 目前是 `蜘蛛` / `盲蛛`，显示时自动加“目”；以后加 `伪蝎`、`裂盾` 等，CSV 第一列写 `伪蝎` 即可，筛选按钮会自动出现。

### 加/改生境、采集方法
- 默认清单在 `app.js` 顶部的 `DEFAULT_HABITATS` / `DEFAULT_METHODS`。
- 使用者也可以在设置页按行编辑并保存（存在 `state.settings.habitats/methods`）。
- 记录里保存的是文本，改名不会影响旧记录。

### 改编号格式
- 设置项：`noPrefix`（`HBUARA#`）、`noYear`（`2026`）、`noNext`（`799`）。
- 代码：`formatNo()`、`nextNo()`。
- 同一采集点/组共用当前编号，不自动递增；换点/换组时手动改“本组编号”或 `noNext`。

### 改记录字段
- 表单：`recordFormHTML()`、`saveRecordForm()`。
- 记录对象：`buildRecord()`。
- 列表：`recordCard()`。
- CSV：`exportCSV()`。
- 日报：`buildReport()`（HTML/打印）与 `pdfSummaryPage()` / `pdfRecordCard()`（直接下载的图片版 PDF）。
- 改字段后，旧记录要兼容：在 `loadState()` 或 `normalizeRecord()` 里补默认值。

### 改颜色/字号
- 全部变量在 `style.css` 顶部 `:root`。
- 深色块是 `--green-3`，强调色 `--green-2`，背景 `--bg`。

### 改“目”的显示
- 数据里存短名（`蜘蛛`/`盲蛛`），显示函数 `groupLabel()` 自动加“目”。
- 新增目时不用改这个函数，只要 CSV 第一列写新目名。

## 3. 数据存在哪

- 记录/设置/名录：浏览器 `localStorage`，键名 `zhuji.state.v1`。
- 照片：浏览器 IndexedDB，库名 `zhuji.photos`。
- 换网址、换浏览器、清缓存都会看不到旧数据。
- 设置 → 数据 → 导出 JSON 备份；照片不进去，需要单独保存。
- **不要让使用者“清除浏览数据”**；升级前先导出备份。

## 4. 本地测试

```powershell
# 在 prototype 文件夹
python -m http.server 8000
```

打开 `http://localhost:8000`。定位/麦克风需要 HTTPS 或 localhost；`file://` 不行。

改完至少测：

1. 开始一次采集 → 大圆变“+” → 科/属/种各记一条；
2. 科 sp. / 属 sp.；
3. 搜索“横纹金蛛”跳级；
4. 改编号、重复编号提示；
5. 结束 → 写小结 → 日报有小结；
6. 下载 PDF 能打开；
7. 刷新页面，记录还在；
8. 手机 390×844 无横向溢出。

## 5. 发版流程

1. 改完先复制一份 `prototype` 为 `versions/v2.x`（或在 Git 打 tag）。
2. 更新 `CHANGELOG.md`。
3. 把 `sw.js` 的 `CACHE` 改成新版本号，避免旧缓存。
4. 重新压缩 `蛛迹_原型_v2.x.zip`。
5. 部署后手机刷新一次；必要时重新“添加到主屏幕”。

## 6. 上下文用完后怎么继续改

最稳的做法是**把“代码 + 说明 + 这次要改的清单”一起交给下一个会话/开发者**：

1. 保留 `蛛迹_原型_v2.x.zip`（或整个 `prototype` 文件夹）；
2. 同时附上 `README.md`、`CHANGELOG.md`、本文件；
3. 用下面这段作为开场：

```text
这是一个无框架的野外采集 PWA，代码在附件 zip / prototype 目录。
请先通读 README.md、CHANGELOG.md、MAINTENANCE.md，再读 index.html、style.css、app.js。
当前版本 v2.3.0。不要改 taxonomy-data.js 的内置数据，除非我明确要求。
本次只改：
1）……
2）……
改完请：更新 CHANGELOG、把 sw.js 的 CACHE 版本 +1、重新打包 zip，
并逐项告诉我改了哪些函数、怎么测试。
```

4. 一次只提 1–3 个具体改动，附截图/例子（如编号 `HBUARA#2026-799`）；
5. 要求对方**先读文件再改**，不要凭记忆重写整个 `app.js`；
6. 改完先在自己手机试 3 条记录，再正式用。

## 7. 不要做

- 不要压缩/混淆 `app.js`（会失去可修改性）。
- 不要直接把名录写进 `app.js`。
- 不要删除 `taxonomy-data.js` 或 `分类名录_v2.csv`。
- 不要在没备份时清空浏览器数据。
- 不要把 `sw.js` 的缓存版本留在旧号（用户会看到旧界面）。
