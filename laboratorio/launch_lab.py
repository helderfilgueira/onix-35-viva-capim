"""Local launcher; no external hosting or network exposure."""
import os
import threading
import webbrowser
import server

if __name__ == '__main__':
    os.environ.setdefault('VIVA_PORT', '8878')
    url = f"http://127.0.0.1:{int(os.environ['VIVA_PORT'])}/explorar.html"
    threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    server.main()
