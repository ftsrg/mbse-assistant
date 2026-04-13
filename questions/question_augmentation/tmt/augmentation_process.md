## Question sources and augmentation workflow

We use the CSV file that contains domain-expert questions:

- `questions/question_augmentation/tmt/expert_questions/expert_questions.csv`  

## Additional model-derived inputs

Besides the expert question CSV file, we also use two JSON files derived from the TMT model.

### 1. SysML blocks appearing in the model

File:

- `questions/question_augmentation/tmt/model_content/blocks.json`

This file contains the `vocab:block` values that appear in the model.

The result was obtained from the Fuseki endpoint with the following query:

```sparql
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX vocab: <http://api.koneksys.com/cameo/vocab/>
BASE <http://api.koneksys.com/cameo/>

SELECT distinct ?block 
WHERE {
  ?block a vocab:block .
}
```

### 2.SysML packages appearing in the model

File:

- `questions/question_augmentation/tmt/model_content/packages.json`

This file contains the `vocab:block` values that appear in the model.

The result was obtained from the Fuseki endpoint with the following query:

```sparql
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX vocab: <http://api.koneksys.com/cameo/vocab/>
BASE <http://api.koneksys.com/cameo/>

SELECT distinct ?package 
WHERE {
  ?package a vocab:package .
}
```

## Question augmentation

We use **ChatGPT Thinking 5.2** for question generation.

Prompt file:

- `questions/question_augmentation/tmt/augmentation_prompt.md`

After generation, the augmented questions are stored in:

- `questions/question_augmentation/tmt/augmented_questions/augmented_questions.csv`

The output file follow a CSV structure similar to the corresponding expert question set.
