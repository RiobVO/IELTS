#!/usr/bin/env python3
"""
Генератор графиков IELTS Academic Writing Task 1 с ИЗВЕСТНЫМИ данными.

Зачем: Task 1 оценивается СРАВНЕНИЕМ эссе с визуалом, поэтому нам нужны картинки,
у которых ground-truth данные сохранены машиночитаемо — для (а) seed-каталога,
(б) калибровки оценщика (scripts/benchmark-writing.ts), (в) ручной проверки, что
vision читает график верно. Детерминированный, без случайности: повторный запуск
даёт байт-в-байт те же данные (картинки могут отличаться рендером шрифта).

Вывод в content/writing-task1/<slug>.png + <slug>.json. JSON содержит type, title,
units, данные серий, key_features (для калибровки) и prompt (инструкция IELTS).

Запуск:  python scripts/gen-task1-charts.py
Зависимость: matplotlib (dev-only, для генерации контента; в рантайме не нужен).
"""
import json
import sys
from pathlib import Path

# Windows-консоль по умолчанию cp1251 — не кодирует не-ASCII в print (→, +, °).
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

import matplotlib
matplotlib.use("Agg")  # без дисплея — пишем в файл
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch

OUT = Path(__file__).resolve().parent.parent / "content" / "writing-task1"
DPI = 110
# Нейтральная «экзаменационная» палитра — высокий контраст, читается vision-моделью.
COLORS = ["#2F73E8", "#E0484D", "#1F9D6B", "#DB7A2B", "#6D5AE6"]

# Стандартная вторая половина инструкции Academic Task 1.
SUMMARISE = ("Summarise the information by selecting and reporting the main "
             "features, and make comparisons where relevant.")


def _save(fig, slug: str, meta: dict) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUT / f"{slug}.png", dpi=DPI, bbox_inches="tight",
                facecolor="white")
    plt.close(fig)
    (OUT / f"{slug}.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  + {slug}.png  + {slug}.json")


def bar_spending() -> None:
    """Сгруппированная столбчатая: расходы домохозяйств по категориям, 3 страны."""
    cats = ["Housing", "Food", "Transport", "Leisure"]
    data = {  # % среднемесячного бюджета
        "France": [28, 22, 14, 12],
        "Germany": [31, 18, 16, 10],
        "Spain": [25, 26, 12, 9],
    }
    x = range(len(cats))
    width = 0.26
    fig, ax = plt.subplots(figsize=(7.6, 4.6))
    for i, (country, vals) in enumerate(data.items()):
        ax.bar([p + (i - 1) * width for p in x], vals, width,
               label=country, color=COLORS[i], edgecolor="white")
    ax.set_title("Average household monthly spending by category, 2022",
                 fontsize=13, fontweight="bold", pad=12)
    ax.set_ylabel("Share of monthly budget (%)")
    ax.set_xticks(list(x))
    ax.set_xticklabels(cats)
    ax.set_ylim(0, 36)
    ax.legend(title="Country", frameon=False)
    ax.spines[["top", "right"]].set_visible(False)
    ax.grid(axis="y", alpha=0.3)
    _save(fig, "bar_spending", {
        "type": "bar_chart",
        "title": "Average household monthly spending by category, 2022",
        "units": "share of monthly budget (%)",
        "categories": cats,
        "series": data,
        "key_features": [
            "Housing is the largest category for all three countries (25–31%).",
            "Germany spends the most on housing (31%); Spain the least (25%).",
            "Spain spends the most on food (26%), more than on housing-adjacent leisure.",
            "Leisure is the smallest category everywhere (9–12%).",
        ],
        "prompt": ("The bar chart below shows the average share of monthly "
                   "household spending across four categories in France, Germany "
                   "and Spain in 2022. " + SUMMARISE),
    })


def line_coffee_tea() -> None:
    """Линейный график: потребление кофе и чая, 2000–2020."""
    years = [2000, 2005, 2010, 2015, 2020]
    coffee = [1.5, 1.9, 2.3, 2.7, 3.0]   # кг на человека в год
    tea = [2.8, 2.5, 2.1, 1.8, 1.6]
    fig, ax = plt.subplots(figsize=(7.6, 4.6))
    ax.plot(years, coffee, marker="o", color=COLORS[0], linewidth=2.4,
            label="Coffee")
    ax.plot(years, tea, marker="s", color=COLORS[1], linewidth=2.4, label="Tea")
    ax.set_title("Coffee and tea consumption in the UK, 2000–2020",
                 fontsize=13, fontweight="bold", pad=12)
    ax.set_ylabel("Kg per person per year")
    ax.set_xlabel("Year")
    ax.set_xticks(years)
    ax.set_ylim(0, 3.5)
    ax.legend(frameon=False)
    ax.spines[["top", "right"]].set_visible(False)
    ax.grid(alpha=0.3)
    _save(fig, "line_coffee_tea", {
        "type": "line_graph",
        "title": "Coffee and tea consumption in the UK, 2000–2020",
        "units": "kg per person per year",
        "x_axis": years,
        "series": {"Coffee": coffee, "Tea": tea},
        "key_features": [
            "Coffee rose steadily from 1.5 to 3.0 kg over the period.",
            "Tea fell steadily from 2.8 to 1.6 kg.",
            "The two lines crossed around 2012, after which coffee overtook tea.",
        ],
        "prompt": ("The line graph below shows coffee and tea consumption per "
                   "person in the UK between 2000 and 2020. " + SUMMARISE),
    })


def pie_energy() -> None:
    """Две круговые: источники энергии домохозяйства, 2000 vs 2020."""
    labels = ["Gas", "Electricity", "Oil", "Renewables"]
    y2000 = [45, 30, 20, 5]
    y2020 = [30, 33, 12, 25]
    fig, axes = plt.subplots(1, 2, figsize=(8.4, 4.4))
    for ax, vals, year in ((axes[0], y2000, 2000), (axes[1], y2020, 2020)):
        ax.pie(vals, labels=labels, autopct="%1.0f%%", startangle=90,
               colors=COLORS[:4], wedgeprops={"edgecolor": "white"})
        ax.set_title(str(year), fontsize=12, fontweight="bold")
    fig.suptitle("Household energy sources, 2000 vs 2020 (%)",
                 fontsize=13, fontweight="bold")
    _save(fig, "pie_energy", {
        "type": "pie_chart",
        "title": "Household energy sources, 2000 vs 2020 (%)",
        "units": "share of household energy (%)",
        "categories": labels,
        "series": {"2000": y2000, "2020": y2020},
        "key_features": [
            "Gas fell from the largest source (45%) to 30% over the period.",
            "Renewables grew five-fold, from 5% to 25%.",
            "Electricity rose modestly (30% to 33%) and became the largest source in 2020.",
            "Oil roughly halved, from 20% to 12%.",
        ],
        "prompt": ("The two pie charts below show the sources of energy used by "
                   "households in 2000 and 2020. " + SUMMARISE),
    })


def table_enrolment() -> None:
    """Таблица: доля студентов по факультетам, 2010 vs 2020."""
    cols = ["Faculty", "2010 (%)", "2020 (%)"]
    rows = [
        ["Engineering", "24", "31"],
        ["Business", "30", "27"],
        ["Arts", "22", "15"],
        ["Sciences", "16", "19"],
        ["Law", "8", "8"],
    ]
    fig, ax = plt.subplots(figsize=(6.8, 3.6))
    ax.axis("off")
    ax.set_title("University enrolment by faculty, 2010 vs 2020",
                 fontsize=13, fontweight="bold", pad=16)
    tbl = ax.table(cellText=rows, colLabels=cols, loc="center",
                   cellLoc="center")
    tbl.auto_set_font_size(False)
    tbl.set_fontsize(11)
    tbl.scale(1, 1.8)
    for c in range(len(cols)):
        cell = tbl[0, c]
        cell.set_facecolor(COLORS[0])
        cell.set_text_props(color="white", fontweight="bold")
    _save(fig, "table_enrolment", {
        "type": "table",
        "title": "University enrolment by faculty, 2010 vs 2020",
        "units": "share of total enrolment (%)",
        "columns": cols,
        "rows": rows,
        "key_features": [
            "Engineering overtook Business to become the largest faculty (24%→31%).",
            "Business declined slightly (30%→27%) and fell to second.",
            "Arts saw the steepest fall, from 22% to 15%.",
            "Law was unchanged at 8% across the decade.",
        ],
        "prompt": ("The table below shows the percentage of university students "
                   "enrolled in five faculties in 2010 and 2020. " + SUMMARISE),
    })


def process_glass() -> None:
    """Процесс-диаграмма: переработка стекла (стадии-боксы + стрелки)."""
    stages = [
        "Used glass\ncollected",
        "Sorted by\ncolour",
        "Washed &\ncrushed",
        "Melted at\n1500°C",
        "Moulded into\nnew bottles",
    ]
    fig, ax = plt.subplots(figsize=(9.6, 3.0))
    ax.set_xlim(0, len(stages) * 2)
    ax.set_ylim(0, 2)
    ax.axis("off")
    ax.set_title("The process of recycling glass bottles",
                 fontsize=13, fontweight="bold", y=1.02)
    for i, label in enumerate(stages):
        cx = i * 2 + 1
        box = FancyBboxPatch((cx - 0.85, 0.6), 1.7, 0.8,
                             boxstyle="round,pad=0.04",
                             linewidth=1.6, edgecolor=COLORS[0],
                             facecolor="#E6EEFB")
        ax.add_patch(box)
        ax.text(cx, 1.0, f"{i+1}. {label}", ha="center", va="center",
                fontsize=9.5, fontweight="bold")
        if i < len(stages) - 1:
            ax.add_patch(FancyArrowPatch(
                (cx + 0.9, 1.0), (cx + 1.1, 1.0),
                arrowstyle="-|>", mutation_scale=18, color="#444", lw=1.6))
    _save(fig, "process_glass", {
        "type": "process_diagram",
        "title": "The process of recycling glass bottles",
        "units": "stages (sequential)",
        "stages": [s.replace("\n", " ") for s in stages],
        "key_features": [
            "The process is linear with five stages, from collection to new bottles.",
            "Glass is sorted by colour before being washed and crushed.",
            "Melting occurs at 1500°C, the only stated temperature.",
            "The final stage moulds the molten glass into new bottles.",
        ],
        "prompt": ("The diagram below shows how glass bottles are recycled. "
                   "Summarise the information by selecting and reporting the main "
                   "features, and make comparisons where relevant."),
    })


def main() -> None:
    print(f"Generating Task 1 charts → {OUT}")
    for fn in (bar_spending, line_coffee_tea, pie_energy, table_enrolment,
               process_glass):
        fn()
    pngs = sorted(OUT.glob("*.png"))
    jsons = sorted(OUT.glob("*.json"))
    print(f"[OK] {len(pngs)} PNG + {len(jsons)} JSON written")
    if len(pngs) != len(jsons) or len(pngs) < 5:
        raise SystemExit(f"[FAIL] expected 5 PNG+JSON pairs, got "
                         f"{len(pngs)} PNG / {len(jsons)} JSON")


if __name__ == "__main__":
    main()
