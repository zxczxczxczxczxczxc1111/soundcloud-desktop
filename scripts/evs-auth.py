"""Авторизация EVS через официальный CLI без вывода секретов."""
import subprocess
import sys

if __name__ == '__main__':
    sys.exit(subprocess.call([sys.executable, '-m', 'castlabs_evs.account', '--no-ask', 'reauth']))
