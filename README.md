# YmusicPlayer
本地音乐播放器，鉴于好多播放器因为版权问题不支持本地播放一些歌曲，只能自己搞一个了

## 本地打包

```bash
npm install
npm run dist:win    # Windows: 生成 exe（NSIS 安装包）
npm run dist:linux  # Linux: 生成 AppImage + deb
npm run dist:mac    # macOS: 生成 dmg
```

产物目录：`release/`

## 在线搜索下载

播放器内已预留“下载”页，可从网易云音乐、汽水音乐、咪咕音乐、QQ 音乐、酷我音乐搜索并下载到本地曲库。

开发环境下会优先使用相邻项目 `/home/eric/data/python/musicdl` 作为 Python 后端；如果路径不同，可设置：

```bash
export YMUSICDL_DEV_PATH=/path/to/musicdl
npm run dev
```

正式打包会通过 `dist:renderer` 自动执行 `npm run helper:build`，把 Python/musicdl 封装成 `ymusicdl-helper` 并放进安装包。这样安装到一台没有 Python 的电脑上也可以使用“下载”页。

注意：打包这一步发生在开发/构建机器上，因此构建机器需要已安装 Python、PyInstaller，以及 musicdl 依赖；目标用户机器不需要安装 Python。如 musicdl 不在默认位置，可设置：

```bash
export MUSICDL_REPO=/path/to/musicdl
npm run helper:build
```

注意：`musicdl` 使用 PolyForm Noncommercial License 1.0.0，内置下载功能仅适合非商业用途，并请遵守相关音乐平台条款与版权要求。

## GitHub 自动发版（exe / AppImage / deb / dmg）

已提供工作流：`.github/workflows/release.yml`

触发方式：
1. 推送版本 tag（如 `v0.1.1`）会自动构建并发布到 GitHub Releases。
2. 也可在 Actions 页面手动运行（`workflow_dispatch`）。

示例命令：

```bash
git tag v0.1.1
git push origin v0.1.1
```

## 注意事项

1. Windows 安装包如果未做代码签名，安装时会出现“未知发布者”提示（正常）。
2. macOS `dmg` 未签名/未公证时，首次打开可能被 Gatekeeper 拦截，需要“系统设置 -> 隐私与安全性”里手动放行。
