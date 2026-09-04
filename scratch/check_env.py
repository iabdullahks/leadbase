import sys

libs = ['aiohttp', 'httpx', 'requests', 'urllib3']
for lib in libs:
    try:
        __import__(lib)
        print(f"{lib}: INSTALLED")
    except ImportError:
        print(f"{lib}: NOT INSTALLED")
