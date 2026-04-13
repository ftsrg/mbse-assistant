import csv
from collections import defaultdict
from pathlib import Path

from SPARQLWrapper import SPARQLWrapper, JSON


# install: `pip install SPARQLWrapper`

SCRIPT_DIR = Path(__file__).parent


def write_to_csv(results, filename):
    vars_ = results["head"]["vars"]

    # Write to CSV
    with open(SCRIPT_DIR / (filename + ".csv"), "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)

        # Header
        writer.writerow(vars_)

        # Rows
        for result in results["results"]["bindings"]:
            row = []
            for var in vars_:
                value = result.get(var, {}).get("value", "")
                row.append(value)
            writer.writerow(row)


def extract_class_from_predicate(p_uri):
    base = "http://api.koneksys.com/cameo/vocab/"
    if not p_uri.startswith(base):
        return None

    after = p_uri[len(base):]

    # Split at '#'
    if "#" in after:
        return after.split("#")[0]
    return after


def write_csv_superclasses(grouped, filename):
    with open(SCRIPT_DIR / (filename + ".csv"), "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)

        # Header
        writer.writerow(["class", "superclasses"])

        for source, classes in grouped.items():
            class_list = ",".join(sorted(classes))
            writer.writerow([source, class_list])


def normalize(name: str) -> str:
    return name.replace("%20", "").lower()


def write_predicate_information(predicates_by_class: dict, output_filename):
    """
    Receives a dict { class_name: [predicate, ...] } built in memory
    and writes a human-readable predicate_information.txt.
    """
    with open(SCRIPT_DIR / output_filename, "w", encoding="utf-8") as f:
        f.write("Here is a list of the predicates that appear in the model, grouped by class.\n")
        f.write("Rule: to form a valid predicate, you have to put "
                "'http://api.koneksys.com/cameo/vocab/' before class name, "
                "and the predicates inside the class can follow after '_'.\n")
        f.write(" Example: AcceptEventAction class with its result predicate -> "
                "http://api.koneksys.com/cameo/vocab/AcceptEventAction_result\n")
        f.write("The list:\n\n")

        for class_name in sorted(predicates_by_class.keys()):
            predicates = predicates_by_class[class_name]
            predicate_list = ", ".join(f"- {p}" for p in sorted(predicates))
            f.write(f"Class: {class_name}  |	Predicates: {predicate_list}\n")


def write_class_information_from_csv(csv_filename, output_filename):
    with open(SCRIPT_DIR / csv_filename, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    with open(SCRIPT_DIR / output_filename, "w", encoding="utf-8") as f:
        f.write("Here is a list of the classes that appear in the model, followed by their superclasses.\n")
        f.write("Rule: each class has the same attributes and properties as their superclasses and the superclasses of those.\n")
        f.write("The list:\n\n")

        for row in rows:
            class_name = row["class"]
            superclasses = ", ".join(row["superclasses"].split(","))
            f.write(f"Class {class_name} has superclasses {superclasses}.\n")


def write_to_csv_if_not_exists(results, filename):
    path = SCRIPT_DIR / (filename + ".csv")
    if path.exists():
        return
    write_to_csv(results, filename)

def write_csv_superclasses_if_not_exists(grouped, filename):
    path = SCRIPT_DIR / (filename + ".csv")
    if path.exists():
        return
    write_csv_superclasses(grouped, filename)

if __name__ == '__main__':
    endpoint_url = "http://localhost:3030/sysml/sparql"

    sparql = SPARQLWrapper(endpoint_url)
    sparql.setReturnFormat(JSON)

    all_predicates = """
        SELECT DISTINCT ?pred WHERE {
          ?s ?pred ?o .
        }"""

    predicates_vocab = """
        SELECT DISTINCT ?p
    WHERE {
      ?s ?p ?o .
      FILTER(STRSTARTS(STR(?p), "http://api.koneksys.com/cameo/vocab/"))
    }
    order by ?p"""
    sparql.setQuery(predicates_vocab)
    predicates_vocab_results = sparql.query().convert()
    write_to_csv_if_not_exists(predicates_vocab_results, "predicates_vocab")

    # Build predicates_by_class in memory from the SPARQL results
    base = "http://api.koneksys.com/cameo/vocab/"
    predicates_by_class = defaultdict(list)
    for result in predicates_vocab_results["results"]["bindings"]:
        uri = result.get("p", {}).get("value", "")
        if not uri.startswith(base):
            continue
        after = uri[len(base):]
        if "#" in after:
            class_name, predicate = after.split("#", 1)
        elif "_" in after:
            class_name, predicate = after.split("_", 1)
        else:
            continue
        predicates_by_class[class_name].append(predicate)

    all_types = """
        SELECT DISTINCT ?class WHERE {
          ?s a ?class .
        }
        ORDER BY ?class
        """

    sparql.setQuery(all_types)
    write_to_csv(sparql.query().convert(), "all_types")

    pred_per_types = """
    SELECT DISTINCT ?source_class ?p WHERE {
      ?s a ?source_class .
      ?s ?p ?o .
    }
    """
    sparql.setQuery(pred_per_types)
    write_to_csv(sparql.query().convert(), "pred_per_types")

    # Grouping structure
    grouped = defaultdict(set)

    results = sparql.query().convert()
    for result in results["results"]["bindings"]:
        source = result["source_class"]["value"].split("/")[-1]
        predicate = result["p"]["value"]

        class_part = extract_class_from_predicate(predicate)

        if class_part:
            grouped[source].add(class_part)

    write_csv_superclasses(grouped, "superclasses_from_preds")

    lowercase_to_encoded_class_names_map = {
        normalize(k): k for k in grouped.keys()
    }
    lowercase_to_uppercase_class_names_map = {
        normalize(v): v for v in set(v for superclasses in grouped.values() for v in superclasses)
    }

    normalized_grouped = {normalize(k): set(normalize(v) for v in superclasses if normalize(k) != normalize(v)) for
                          k, superclasses in grouped.items()}

    while True:
        change_in_cls = False
        for cls, superclasses in normalized_grouped.items():
            collected = set()

            while True:
                change_in_superclass = False
                for superclass in superclasses:
                    super_super_classes = normalized_grouped.get(superclass)
                    if not super_super_classes:
                        continue

                    intersection = super_super_classes.intersection(superclasses)
                    if len(intersection) > 0:
                        superclasses -= intersection

                        change_in_superclass = True
                        change_in_cls = True
                        break
                if not change_in_superclass:
                    break

        if not change_in_cls:
            break

    restored_names_grouped = {lowercase_to_encoded_class_names_map[k]:
                                  (set(lowercase_to_uppercase_class_names_map[v] for v in superclasses)
                                   | ({lowercase_to_uppercase_class_names_map[k]}
                                      if k in lowercase_to_uppercase_class_names_map else set()))
                              for k, superclasses in normalized_grouped.items()}

    write_csv_superclasses_if_not_exists(restored_names_grouped, "superclasses_from_preds_no_indirect")

    write_predicate_information(predicates_by_class, "predicate_information.txt")
    write_class_information_from_csv("superclasses_from_preds_no_indirect.csv", "class_information.txt")
