import argparse
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--action", required=True)
    parser.add_argument("--keyword", default="")
    args = parser.parse_args()

    print(f"[fetch_deals] action={args.action}, keyword={args.keyword}", flush=True)
    for i in range(1, 6):
        print(f"[fetch_deals] step {i}/5", flush=True)
        time.sleep(1)
    print("[fetch_deals] done", flush=True)


if __name__ == "__main__":
    main()
