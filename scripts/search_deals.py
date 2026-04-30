import argparse
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--action", required=True)
    parser.add_argument("--keyword", default="")
    args = parser.parse_args()

    print(f"[search_deals] action={args.action}, keyword={args.keyword}", flush=True)
    for i in range(1, 4):
        print(f"[search_deals] scanning chunk {i}/3", flush=True)
        time.sleep(1)
    print("[search_deals] done", flush=True)


if __name__ == "__main__":
    main()
