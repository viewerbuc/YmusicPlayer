#!/usr/bin/env python3
import argparse
import base64
import contextlib
import io
import json
import os
import sys
import traceback
from pathlib import Path

from pathvalidate import sanitize_filename


SUPPORTED_SOURCES = {
    "NeteaseMusicClient": "网易云音乐",
    "SodaMusicClient": "汽水音乐",
    "MiguMusicClient": "咪咕音乐",
    "QQMusicClient": "QQ音乐",
    "KuwoMusicClient": "酷我音乐",
}

SOURCE_ALIASES = {
    "netease": "NeteaseMusicClient",
    "163": "NeteaseMusicClient",
    "wangyi": "NeteaseMusicClient",
    "soda": "SodaMusicClient",
    "qishui": "SodaMusicClient",
    "migu": "MiguMusicClient",
    "qq": "QQMusicClient",
    "kuwo": "KuwoMusicClient",
}


def add_import_paths():
    ensure_writable_app_dirs()
    base_dir = Path(__file__).resolve().parent
    candidates = []

    for env_name in ("YMUSICDL_VENDOR_PATH", "YMUSICDL_DEV_PATH"):
        env_value = os.environ.get(env_name)
        if env_value:
            candidates.extend(Path(p) for p in env_value.split(os.pathsep) if p)

    candidates.extend([
        base_dir / "vendor",
        base_dir.parent / "vendor",
        base_dir.parent / "python" / "vendor",
    ])

    try:
        candidates.append(base_dir.parents[2] / "python" / "musicdl")
    except IndexError:
        pass

    for candidate in candidates:
        if candidate.exists():
            sys.path.insert(0, str(candidate))


def ensure_writable_app_dirs():
    fallback_root = Path(os.environ.get("YMUSICDL_STATE_ROOT") or Path.cwd() / ".ymusicdl-state").resolve()
    env_defaults = {
        "XDG_STATE_HOME": fallback_root / "state",
        "XDG_CACHE_HOME": fallback_root / "cache",
        "XDG_DATA_HOME": fallback_root / "data",
    }
    for env_name, default_path in env_defaults.items():
        target = Path(os.environ.get(env_name) or default_path).expanduser()
        try:
            target.mkdir(parents=True, exist_ok=True)
            os.environ[env_name] = str(target)
        except Exception:
            backup = fallback_root / env_name.lower()
            backup.mkdir(parents=True, exist_ok=True)
            os.environ[env_name] = str(backup)


def load_musicdl_modules():
    add_import_paths()
    from musicdl import musicdl as musicdl_module
    from musicdl.modules.utils import SongInfo
    return musicdl_module, SongInfo


def emit(payload, exit_code=0):
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    raise SystemExit(exit_code)


def json_safe(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, bytes):
        return {"__bytes_base64__": base64.b64encode(value).decode("ascii")}
    if isinstance(value, bytearray):
        return {"__bytes_base64__": base64.b64encode(bytes(value)).decode("ascii")}
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [json_safe(v) for v in value]
    if hasattr(value, "todict"):
        return json_safe(value.todict())
    return str(value)


def restore_json_safe(value):
    if isinstance(value, dict):
        if set(value.keys()) == {"__bytes_base64__"}:
            try:
                return base64.b64decode(value["__bytes_base64__"])
            except Exception:
                return b""
        return {k: restore_json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [restore_json_safe(v) for v in value]
    return value


def parse_sources(raw_sources):
    if isinstance(raw_sources, str):
        parts = [p.strip() for p in raw_sources.split(",") if p.strip()]
    elif isinstance(raw_sources, list):
        parts = raw_sources
    else:
        parts = []
    if not parts:
        parts = list(SUPPORTED_SOURCES.keys())
    sources = []
    for item in parts:
        normalized = SOURCE_ALIASES.get(str(item).strip().lower(), str(item).strip())
        if normalized in SUPPORTED_SOURCES and normalized not in sources:
            sources.append(normalized)
    return sources or list(SUPPORTED_SOURCES.keys())


@contextlib.contextmanager
def capture_console():
    stdout_buffer = io.StringIO()
    stderr_buffer = io.StringIO()
    with contextlib.redirect_stdout(stdout_buffer), contextlib.redirect_stderr(stderr_buffer):
        yield stdout_buffer, stderr_buffer


def make_client(musicdl_module, sources, work_dir, limit_per_source):
    init_cfg = {
        source: {
            "work_dir": work_dir,
            "search_size_per_source": limit_per_source,
            "search_size_per_page": min(20, max(1, limit_per_source)),
            "disable_print": True,
        }
        for source in sources
    }
    return musicdl_module.MusicClient(music_sources=sources, init_music_clients_cfg=init_cfg)


def compact_song_info(song_info, index=0):
    data = json_safe(song_info.todict() if hasattr(song_info, "todict") else song_info)
    source = data.get("source") or ""
    identifier = data.get("identifier") or str(index)
    return {
        "key": f"{source}:{identifier}:{index}",
        "source": source,
        "source_label": SUPPORTED_SOURCES.get(source, source),
        "root_source": data.get("root_source"),
        "song_name": data.get("song_name") or "Unknown Song",
        "singers": data.get("singers") or "Unknown Artist",
        "album": data.get("album") or "Unknown Album",
        "ext": data.get("ext") or "",
        "file_size": data.get("file_size") or "NULL",
        "duration": data.get("duration") or "-:-:-",
        "duration_s": data.get("duration_s") or 0,
        "identifier": str(identifier),
        "cover_url": data.get("cover_url") or "",
        "has_lyric": bool(data.get("lyric") and data.get("lyric") != "NULL"),
        "payload": data,
    }


def command_sources(_args):
    emit({
        "ok": True,
        "sources": [{"id": key, "label": label} for key, label in SUPPORTED_SOURCES.items()],
    })


def command_search(args):
    try:
        musicdl_module, _SongInfo = load_musicdl_modules()
        sources = parse_sources(args.sources)
        work_dir = str(Path(args.work_dir).expanduser().resolve()) if args.work_dir else str(Path.cwd() / "musicdl_outputs")
        logs = ""
        with capture_console() as (stdout_buffer, stderr_buffer):
            client = make_client(musicdl_module, sources, work_dir, max(1, args.limit_per_source))
            raw_results = client.search(keyword=args.keyword)
            logs = stdout_buffer.getvalue() + stderr_buffer.getvalue()
        results = []
        for source in sources:
            for song_info in raw_results.get(source, []) or []:
                results.append(compact_song_info(song_info, len(results)))
        emit({"ok": True, "results": results, "logs": logs[-4000:]})
    except Exception as err:
        emit({"ok": False, "error": str(err), "traceback": traceback.format_exc()}, 1)


def read_download_payload(args):
    if args.input_json and args.input_json != "-":
        return json.loads(Path(args.input_json).read_text("utf-8"))
    raw = sys.stdin.read()
    return json.loads(raw or "{}")


def derive_audio_path(song_info_dict):
    save_path = song_info_dict.get("_save_path")
    candidates = []
    if save_path:
        candidates.append(Path(save_path))
        candidates.append(Path(save_path).with_suffix(".m4a"))
    work_dir = song_info_dict.get("work_dir") or "."
    song_name = song_info_dict.get("song_name") or "Unknown Song"
    identifier = song_info_dict.get("identifier") or ""
    ext = str(song_info_dict.get("ext") or "").lstrip(".") or "mp3"
    candidates.append(Path(work_dir) / f"{song_name} - {identifier}.{ext}")
    candidates.append(Path(work_dir) / f"{song_name} - {identifier}.m4a")
    for candidate in candidates:
        if candidate.exists():
            return str(candidate.resolve())
    pattern = f"{song_name} - {identifier}.*" if identifier else f"{song_name}*"
    matches = sorted(Path(work_dir).glob(pattern)) if Path(work_dir).exists() else []
    for match in matches:
        if match.suffix.lower() in {".mp3", ".flac", ".m4a", ".aac", ".ogg", ".wav", ".wma"}:
            return str(match.resolve())
    return str(candidates[0].resolve())


def downloaded_result(song_info):
    data = json_safe(song_info.todict() if hasattr(song_info, "todict") else song_info)
    audio_path = derive_audio_path(data)
    lrc_path = str(Path(audio_path).with_suffix(".lrc"))
    data["audio_path"] = audio_path
    data["lrc_path"] = lrc_path if Path(lrc_path).exists() else ""
    return data


def first_artist_name(singers):
    text = str(singers or "").strip()
    if not text or text.upper() == "NULL":
        return "Unknown Artist"
    for sep in [",", "，", "/", "、", "&", "；", ";"]:
        if sep in text:
            text = text.split(sep)[0].strip()
            break
    return text or "Unknown Artist"


def build_save_stem(song_info):
    artist = sanitize_filename(first_artist_name(getattr(song_info, "singers", "")), replacement_text=" ").strip() or "Unknown Artist"
    song_name = sanitize_filename(str(getattr(song_info, "song_name", "") or "Unknown Song"), replacement_text=" ").strip() or "Unknown Song"
    return f"{artist} - {song_name}"


def assign_preferred_save_path(song_info, target_dir: Path):
    ext = str(getattr(song_info, "ext", "") or "mp3").lstrip(".") or "mp3"
    base_path = target_dir / f"{build_save_stem(song_info)}.{ext}"
    candidate = base_path
    index = 1
    while candidate.exists() or candidate.with_suffix(".lrc").exists():
        candidate = target_dir / f"{base_path.stem} ({index}){base_path.suffix}"
        index += 1
    song_info._save_path = str(candidate)
    return candidate


def command_download(args):
    try:
        musicdl_module, SongInfo = load_musicdl_modules()
        payload = read_download_payload(args)
        target_dir = Path(payload.get("target_dir") or args.target_dir or Path.cwd()).expanduser().resolve()
        target_dir.mkdir(parents=True, exist_ok=True)
        song_payloads = payload.get("songs") or []
        song_infos = []
        for item in song_payloads:
            data = item.get("payload") if isinstance(item, dict) and item.get("payload") else item
            data = restore_json_safe(data or {})
            song_info = SongInfo.fromdict(data)
            song_info.work_dir = str(target_dir)
            assign_preferred_save_path(song_info, target_dir)
            song_infos.append(song_info)
        sources = parse_sources(payload.get("sources") or [s.source for s in song_infos if s.source])
        logs = ""
        downloaded = []
        with capture_console() as (stdout_buffer, stderr_buffer):
            client = make_client(musicdl_module, sources, str(target_dir), max(1, args.limit_per_source))
            classified = {}
            for song_info in song_infos:
                classified.setdefault(song_info.source, []).append(song_info)
            for source, source_song_infos in classified.items():
                if source not in client.music_clients:
                    continue
                downloaded.extend(client.music_clients[source].download(
                    song_infos=source_song_infos,
                    num_threadings=client.clients_threadings[source],
                    request_overrides=client.requests_overrides[source],
                ) or [])
            logs = stdout_buffer.getvalue() + stderr_buffer.getvalue()
        emit({
            "ok": True,
            "downloaded": [downloaded_result(song_info) for song_info in downloaded],
            "target_dir": str(target_dir),
            "logs": logs[-4000:],
        })
    except Exception as err:
        emit({"ok": False, "error": str(err), "traceback": traceback.format_exc()}, 1)


def main():
    parser = argparse.ArgumentParser(description="YMusicPlayer musicdl JSON helper")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("sources")

    search_parser = subparsers.add_parser("search")
    search_parser.add_argument("--keyword", required=True)
    search_parser.add_argument("--sources", default=",".join(SUPPORTED_SOURCES.keys()))
    search_parser.add_argument("--work-dir", default="")
    search_parser.add_argument("--limit-per-source", type=int, default=15)

    download_parser = subparsers.add_parser("download")
    download_parser.add_argument("--target-dir", default="")
    download_parser.add_argument("--input-json", default="-")
    download_parser.add_argument("--limit-per-source", type=int, default=15)

    args = parser.parse_args()
    if args.command == "sources":
        command_sources(args)
    if args.command == "search":
        command_search(args)
    if args.command == "download":
        command_download(args)


if __name__ == "__main__":
    main()
