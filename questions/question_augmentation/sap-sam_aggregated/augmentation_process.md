## Question sources and augmentation workflow

We use two CSV files that contain domain-expert questions:

- `expert_questions/expert_questions_models.csv`  
  Contains questions about **individual models**.
- `expert_questions/expert_questions_organizations.csv`  
  Contains questions about **organizations that contain the models**.

## Additional model-derived inputs

Besides the two expert question CSV files, we also use two JSON files derived from the aggregated SAP-SAM model.

### 1. RDF types appearing in the model

File:

- `questions\question_augmentation\sap-sam_aggregated\model_content\sap-sam_aggregated_types.json`

This file contains the `rdf:type` values that appear in the model.

The result was obtained from the Fuseki endpoint with the following query:

```sparql
SELECT DISTINCT ?type ?typeShort
WHERE {
  ?s a ?type .
  BIND(REPLACE(STR(?type), "^.*[#/]", "") AS ?typeShort)
}
ORDER BY ?typeShort
```

### 2. Names, labels, and comments appearing in the model

File:

- `questions\question_augmentation\sap-sam_aggregated\model_content\sap-sam_aggregated_summary.json`

This file contains the textual values that appear in the model, specifically:
- `bbo:name`
- `rdfs:label`
- `rdfs:comment`

The result was obtained from the Fuseki endpoint with the following query:

```sparql
PREFIX rdf:    <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs:   <http://www.w3.org/2000/01/rdf-schema#>
PREFIX bbo:    <http://www.onto-bpo.eu/ontologies/bbo#>
PREFIX bboExt: <http://www.onto-bpo.eu/ontologies/bboExtension#>
PREFIX tai:    <https://www.teamingai-project.eu/>

SELECT
  ?organizationId
  ?modelName
  ?modelOriginalId
  ?fieldShort
  (GROUP_CONCAT(DISTINCT STR(?value); separator=" | ") AS ?values)
WHERE {
  ?organization a bboExt:Organization ;
                tai:organizationId ?organizationId .

  ?model a bboExt:Model ;
         tai:belongsTo ?organization ;
         bbo:name ?modelName ;
         tai:originalId ?modelOriginalId .

  ?definitions a bboExt:Definitions ;
               tai:belongsTo ?model .

  ?element tai:belongsTo+ ?definitions ;
           ?field ?value .

  FILTER(isLiteral(?value))
  FILTER(
       ?field = rdfs:label
    || ?field = rdfs:comment
    || ?field = bbo:name
  )

  BIND(REPLACE(STR(?field), "^.*[#/]", "") AS ?fieldShort)
}
GROUP BY ?organizationId ?modelName ?modelOriginalId ?fieldShort
ORDER BY ?organizationId ?modelName ?modelOriginalId ?fieldShort
```

## Question augmentation

We use **Claude 4.6 Opus** for question generation.

Prompt file:

- `questions\question_augmentation\sap-sam_aggregated\augmentation_prompt.txt`

After generation, the augmented questions are stored in:

- `questions\question_augmentation\sap-sam_aggregated\augmented_questions\augmented_questions_models.csv`
- `questions\question_augmentation\sap-sam_aggregated\augmented_questions\augmented_questions_organizations.csv`

Both output files follow a CSV structure similar to the corresponding expert question set.

## Question aggregation

After question generation, the `question_aggregator` script is used to combine all expert and augmented questions.

It produces the following outputs:

- `questions\bpmn_questions.txt`  
  Contains all aggregated questions.
- `questions\question_categories\bpmn_categories.json`  
  Lists the questions belonging to each question category.