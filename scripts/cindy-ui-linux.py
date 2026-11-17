#!/usr/bin/env python3
# 桌宠 ⇄ Cindy 界面桥（Linux，实验功能，未经真机验证）。通过 AT-SPI 读取 Cindy 窗口的界面树。
# 用法：dump | press <序号> <预期名称> | focus      输出一行 JSON
# 依赖：python3-gi、gir1.2-atspi-2.0；系统无障碍服务需开启（GNOME：gsettings set org.gnome.desktop.interface toolkit-accessibility true），
#       开启后需重启 Cindy 才会暴露界面树。Wayland 下可能读不到。
import json, sys

try:
    import gi
    gi.require_version('Atspi', '2.0')
    from gi.repository import Atspi
except Exception as e:  # noqa
    print(json.dumps({'ok': False, 'error': 'noatspi: %s' % e}))
    sys.exit(0)

TEXT_ROLES = set()
for _n in ('LABEL', 'STATIC', 'PARAGRAPH', 'HEADING', 'TEXT', 'SECTION'):
    if hasattr(Atspi.Role, _n):
        TEXT_ROLES.add(getattr(Atspi.Role, _n))
BUTTON_ROLES = set()
for _n in ('PUSH_BUTTON', 'BUTTON'):
    if hasattr(Atspi.Role, _n):
        BUTTON_ROLES.add(getattr(Atspi.Role, _n))


def find_app():
    desk = Atspi.get_desktop(0)
    for i in range(desk.get_child_count()):
        try:
            app = desk.get_child_at_index(i)
            if app and (app.get_name() or '').lower() == 'cindy':
                return app
        except Exception:
            pass
    return None


def text_of(acc):
    try:
        t = Atspi.Text.get_text(acc, 0, Atspi.Text.get_character_count(acc))
        if t:
            return t
    except Exception:
        pass
    return ''


def dump():
    app = find_app()
    if not app:
        return None
    nodes, refs = [], []

    def walk(acc, d):
        if len(nodes) >= 6000 or d > 60:
            return
        try:
            cnt = acc.get_child_count()
        except Exception:
            return
        for i in range(cnt):
            if len(nodes) >= 6000:
                return
            try:
                c = acc.get_child_at_index(i)
                role = c.get_role()
                t = 'Button' if role in BUTTON_ROLES else ('Text' if role in TEXT_ROLES else 'Other')
                n = (c.get_name() or '')
                if t == 'Text' and not n:
                    n = text_of(c)
                n = ' '.join(n.split())
                nodes.append({'d': d, 't': t, 'n': n})
                refs.append(c)
                walk(c, d + 1)
            except Exception:
                continue

    walk(app, 0)
    return nodes, refs


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'dump'
    try:
        if cmd == 'focus':
            app = find_app()
            ok = False
            if app and app.get_child_count():
                try:
                    comp = app.get_child_at_index(0).get_component_iface()
                    ok = bool(comp and comp.grab_focus())
                except Exception:
                    ok = False
            print(json.dumps({'ok': ok}))
            return
        r = dump()
        if r is None:
            print(json.dumps({'ok': True, 'cindy': False, 'nodes': []}))
            return
        nodes, refs = r
        if cmd == 'dump':
            print(json.dumps({'ok': True, 'cindy': True, 'nodes': nodes}, ensure_ascii=False))
        elif cmd == 'press':
            idx = int(sys.argv[2]); want = sys.argv[3] if len(sys.argv) > 3 else ''
            if not (0 <= idx < len(nodes)) or nodes[idx]['n'] != want:
                print(json.dumps({'ok': False, 'error': 'changed'}))
                return
            ok = bool(Atspi.Action.do_action(refs[idx], 0))
            print(json.dumps({'ok': ok, 'error': None if ok else 'noinvoke'}))
        else:
            print(json.dumps({'ok': False, 'error': 'unknown'}))
    except Exception as e:  # noqa
        print(json.dumps({'ok': False, 'error': str(e)}))


main()
