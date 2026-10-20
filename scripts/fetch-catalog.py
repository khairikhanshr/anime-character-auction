"""Refresh the curated catalogue and local image assets from public catalogues."""
import concurrent.futures
import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
ASSETS = ROOT / "dist" / "assets"
ASSETS.mkdir(parents=True, exist_ok=True)
TOPICS = [
    ("demon", 38000, "Kimetsu no Yaiba", "Клинок, рассекающий демонов", "DEMON SLAYER", "#ed793b"),
    ("bleach", 269, "Bleach", "Блич", "BLEACH", "#8f84ed"),
    ("hero", 31964, "Boku no Hero Academia", "Моя геройская академия", "MY HERO ACADEMIA", "#7cb893"),
    ("titan", 16498, "Shingeki no Kyojin", "Атака титанов", "ATTACK ON TITAN", "#c5a176"),
    ("thrones", None, None, "Игра престолов", "GAME OF THRONES", "#88a7bf"),
    ("jujutsu", 40748, "Jujutsu Kaisen", "Магическая битва", "JUJUTSU KAISEN", "#ac82d0"),
]

def request(url, payload=None):
    args = ["curl", "-sS", "-L", "--fail", "--retry", "2", "--max-time", "40", url]
    if payload:
        args += ["-H", "Content-Type: application/json", "--data", json.dumps(payload)]
    return json.loads(subprocess.check_output(args))

catalog = []
downloads = []
for slug, anime_id, manga, title, english, color in TOPICS:
    if anime_id:
        query = """query($id: Int, $search: String) {
          anime: Media(idMal: $id, type: ANIME) {
            coverImage { extraLarge } bannerImage siteUrl
          }
          manga: Media(search: $search, type: MANGA) {
            siteUrl characters(sort: FAVOURITES_DESC, perPage: 24) {
              nodes { id name { full } image { large } favourites siteUrl }
            }
          }
        }"""
        data = request("https://graphql.anilist.co", {"query": query, "variables": {"id": anime_id, "search": manga}})["data"]
        chars = [{"id": f"{slug}-{c['id']}", "name": c["name"]["full"], "originalName": c["name"]["full"],
                  "image": f"assets/{slug}-{c['id']}.jpg", "favorites": c["favourites"], "source": c["siteUrl"]}
                 for c in data["manga"]["characters"]["nodes"]]
        for char, raw in zip(chars, data["manga"]["characters"]["nodes"]):
            downloads.append((raw["image"]["large"], char["image"]))
        cover = data["anime"]["bannerImage"] or data["anime"]["coverImage"]["extraLarge"]
        source = data["manga"]["siteUrl"]
    else:
        cast = request("https://api.tvmaze.com/shows/82/cast")
        priorities = ["Jon Snow", "Daenerys Targaryen", "Tyrion Lannister", "Arya Stark",
                      "Queen Cersei Lannister", "Ser Jaime Lannister", "Sansa Stark", "Lord Eddard Stark",
                      "Bran Stark", "Sandor Clegane", "Petyr \"Littlefinger\" Baelish",
                      "Prince Joffrey Baratheon", "Robb Stark", "Theon Greyjoy", "Lord Tywin Lannister",
                      "Brienne of Tarth", "Davos Seaworth", "Samwell Tarly", "Ser Jorah Mormont",
                      "Ramsay Snow", "Margaery Tyrell", "Stannis Baratheon", "Lord Varys", "Melisandre"]
        def rank(c):
            name = c["character"]["name"]
            return next((i for i, target in enumerate(priorities) if name == target), 99)
        cast = sorted(cast, key=rank)[:24]
        chars = []
        for c in cast:
            char = c["character"]
            image = char.get("image") or c["person"]["image"]
            item = {"id": f"thrones-{char['id']}", "name": char["name"], "originalName": char["name"],
                    "image": f"assets/thrones-{char['id']}.jpg", "source": char["url"]}
            chars.append(item)
            downloads.append((image.get("original") or image["medium"], item["image"]))
        show = request("https://api.tvmaze.com/shows/82")
        cover = show["image"]["original"]
        source = show["url"]
    downloads.append((cover, f"assets/{slug}-cover.jpg"))
    catalog.append({"id": slug, "title": title, "english": english, "color": color,
                    "type": "Сериал" if slug == "thrones" else "Аниме",
                    "cover": f"assets/{slug}-cover.jpg", "source": source, "characters": chars})
    print(title, ":", ", ".join(c["name"] for c in chars), flush=True)

def download(pair):
    url, relative = pair
    path = ROOT / "dist" / relative
    if path.exists() and path.stat().st_size > 500:
        return
    subprocess.run(["curl", "-sS", "-L", "--fail", "--retry", "2", "--max-time", "40", url, "-o", str(path)], check=True)

with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    list(pool.map(download, downloads))
translations_path = ROOT / "scripts" / "translations.json"
translations = json.loads(translations_path.read_text()) if translations_path.exists() else {}
for topic in catalog:
    for char in topic["characters"]:
        char["name"] = translations.get(char["originalName"], char["originalName"])
(ROOT / "dist" / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2))
print(f"Saved {len(catalog)} topics and {sum(len(t['characters']) for t in catalog)} characters.")
