# Benchmark for trustworthy modeling assistants

This repository contains an extensible benchmark framework to support evaluation of LLM-based agents for Model-Based Systems Engineering (MBSE).

The benchmark contains models from the following two domains, as well as partially LLM-generated set of questions and reference answers for them. The models are transformed to RDF using existing semantic mappings.
- A large-scale system engineering model, the [Thirty Meter Telescope (TMT)](https://github.com/Open-MBEE/TMT-SysML-Model) SysML model,
- Business process models (BMPN) from the [Signavio Academic Models](http://dx.doi.org/10.1007/978-3-031-27815-0_33).

The benchmark framework compares the performance of LLM modeling agents by several state-of-the-art, text and model-based metrics from the literature and generates several diagrams to visualize the results.
We demonstrate the usage of the benchmark framework by evaluating our LLM agents which use ontological knowledgebase and SPARQL queries to assist modeling in safety- and business-critical domains.

---

## 1) Environment setup

We tested the environment on Ubuntu 24.04 LTS.

### 1.1 Node / npm

Minimum requirements:
- **Node.js**: >= 18
- **npm**: >=9

Check your local versions:
```bash
node -v
npm -v
```

If `node` or `npm` is missing, install them with:

```bash
sudo apt install nodejs npm
```

### 1.2 Install

Preferred install command (execute in repo root):
```bash
npm ci
```

### 1.3 Download embedding model (REQUIRED before first evaluation)

BERTScore metric requires the Xenova/bert-base-cased model (~100MB-110MB).
- `agent_evaluation/`:
    - `download_embedding_model.ts` - script downloading the embedding model (Xenova/bert-base-cased) used for embedding in BERT Score metric
    - `hf_env.ts`: to keep the embedding model cached in `.cache/transformers/`

**Download the model:**
```bash
npx tsx agent_evaluation/download_embedding_model.ts
```

**Note:** The model is cached in `.cache/transformers/` (repo-local, configured via `agent_evaluation/hf_env.ts`).

### 1.4 Python libraries used for plotting results

For the documented Ubuntu setup, we install the required Python packages with the system package manager, we use *sudo* for system-level package installation commands.

Pandas and Matplotlib are used to create the plots.
```bash
sudo apt install python3-pandas python3-matplotlib
```

### 1.5 Dependency versions

**Direct dependencies (declared in `package.json`, resolved by `package-lock.json`):**
  - @huggingface/transformers: ^3.8.1,
  - @langchain/anthropic: ^0.3.26,
  - @langchain/core: ^0.3.73,
  - @langchain/langgraph: ^0.4.9,
  - @langchain/openai: ^0.6.11,
  - @langchain/tavily: ^0.1.5,
  - dotenv: ^16.6.1,
  - openai: ^6.7.0,
  - tsx: ^4.0.0,
  - typescript: ^5.9.2

### 1.6 API key (OpenRouter / OpenAI-compatible)

**.env (put in repo root):**

Create a `.env` file with:
```env
OPENAI_API_KEY=sk-or-....

OPENAI_BASE_URL=https://openrouter.ai/api/v1

# --- LLM Judge Configuration ---
LLM_JUDGE_MODEL=anthropic/claude-opus-4.6
LLM_JUDGE_TEMPERATURE=0.2

# --- Keyword Counter Agent Configuration ---
KEYWORD_COUNTER_AGENT_MODEL=anthropic/claude-opus-4.6
KEYWORD_COUNTER_AGENT_TEMPERATURE=0
```


### 1.7 Building the SAP-SAM aggregated TTL model

The BPMN benchmark uses an aggregated SAP-SAM TTL file.

Manual prerequisites:

1. Clone the BPMN input models repository into `input-models/`:

```bash
pushd input-models/
git clone --branch DLT4BPM https://github.com/fstiehle/bpmn-sol-llm-benchmark.git
popd
```

2. Download the SAP-SAM Zenodo archive manually from:
`https://zenodo.org/records/7012043`
and unpack it into:
`input-models/sap_sam_2022`

The following step requires `docker` and `rdflib`.


```bash
sudo apt install python3-rdflib
```

If `docker` is missing on Ubuntu, install Docker Engine first:

```bash
sudo apt install ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

cat <<EOF | sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
sudo apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo docker run hello-world
```

Then run:
```bash
sudo bash converters/bpmn-to-kg/build_sap_sam_aggregated_ttl.sh
```
This generates:
- `model_databases/SAP-SAM/aggregated_model.ttl`: the final aggregated .ttl file,
- `model_databases/SAP-SAM/aggregated_model_skipped_models.csv`: the files that were not aggregated, 
- `model_databases/SAP-SAM/aggregated_model_matched_models.csv`: the files that were aggregated.


### 1.8 Apache Jena Fuseki setup

We use Apache Jena Fuseki 5.5.0 for this setup.

Run the following commands in a separate terminal session, not in the repo terminal.

```bash
sudo apt install openjdk-17-jre-headless unzip wget curl tmux
mkdir -p ~/tools
mkdir -p ~/fuseki-base
cd ~/tools

wget https://archive.apache.org/dist/jena/binaries/apache-jena-fuseki-5.5.0.zip
wget https://archive.apache.org/dist/jena/binaries/apache-jena-fuseki-5.5.0.zip.sha512

sha512sum apache-jena-fuseki-5.5.0.zip
cat apache-jena-fuseki-5.5.0.zip.sha512

unzip apache-jena-fuseki-5.5.0.zip

tmux new -s fuseki
cd ~/tools/apache-jena-fuseki-5.5.0
export FUSEKI_BASE=~/fuseki-base
./fuseki-server
```

If Apache Jena Fuseki 5.5.0 has already been downloaded and extracted, you only need the following commands to start it:

```bash
tmux new -s fuseki
cd ~/tools/apache-jena-fuseki-5.5.0
export FUSEKI_BASE=~/fuseki-base
./fuseki-server
```

### 1.10 Relevant folders and files 
- `model_databases/`: the TMT model graphs in TTL format and related license files
  - `TMT/`:
    - `COPYRIGHT`, `LICENSE`: copyright and licesen of the TMT model,
    - `tmt.ttl.zip`: the zipped version of the TMT model in TTL format.
  - `SAP-SAM/`:
    - `aggregated_model_skipped_models.csv`,
    - `aggregated_model_matched_models.csv`,
    - `aggregated_model.ttl`.
- `converters/bpmn-to-kg/`: semantic mapping from BPMN process models to knowledge graph

### 1.11 Create datasets and import the `.ttl` files

**Note:** We use Apache Jena Fuseki 5.5.0

1) Open the UI: `http://localhost:3030/`  
2) **Manage datasets** → **Add new dataset**  
3) Create dataset **`sap-sam-export_aggregated`** and dataset **`sysml`**  
   - choose **TDB2 (persistent)** if you want the data to survive server restarts  
4) For each dataset, open its page → **Add data** → upload the matching `.ttl` file:
   - `sap-sam-export_aggregated`  ← `aggregated_model.ttl`
   - `sysml`   ← `tmt.ttl`
5) Press **upload now**

### 1.12 Endpoint files

- `fuseki_endpoints/`
  - `sysml_endpoint.txt`: the SysML representation of the Thirty Meter Telescope (also referred to as TMT) project
  - `bpmn_endpoint.txt`: aggregated model of the SAP Signavio Academic Models
  - **Format:** the first non-empty (non-comment) line is the endpoint URL  
    (e.g. `http://localhost:3030/sysml/sparql`)

Fill these so the benchmark can query the right dataset:

- `fuseki_endpoints/bpmn_endpoint.txt` → `http://localhost:3030/sap-sam-export_aggregated/sparql`
- `fuseki_endpoints/sysml_endpoint.txt`  → `http://localhost:3030/sysml/sparql`

---
## 2) Agent workflow


### 2.1 Relevant folders and files

- `system_prompts/`:
  - `BPMN_SystemPrompt.ts`: system prompt for the BPMN assistant
  - `SysML_SystemPrompt.ts`: current system prompt for the SysML assistant
  - `SysML_SystemPromptBeforeExploration.ts`: previous system prompt for the SysML assistant

- `questions/`:
  - `sysml_questions.txt`: test questions for the SysML assistant (format: TSV - ```q001<TAB>Question text```)
  - `bpmn_questions.txt`: test questions for the BPMN assistant (format: TSV - ```q001<TAB>Question text```)      
  - `question_augmentation/`: we store question augmentation-related files here
    - `sap-sam_aggregated/` and `tmt/` both have the same structure: 
      - `augmentation_process.md`: the process of augmentation
      - `augmentation_prompt.md`: the prompt used for augmentation
      - `model_content/`: the model element attributes and types needed for the augmentation
      - `expert_questions/`: the expert questions (for BPMN, it is split into 2 categories: model and organization)
      - `augmented_questions/`: the questions we got as the result of augmentation (for BPMN, it is split into 2 categories: model and organization)
  - `mutant_questions/`: contains the mutated version of the SysML and BPMN question sets
  - `question_categories/`: for BPMN and SysML, a JSON contains the ID's of the questions grouped into categories

- `agent_workflow/`:
   - `agent_interface.ts`: the interface any agent we want to run and evaluate has to implement
   - `agent.ts`: the logic of our agents implemented in LangGraph
   - `agent_graph.mmd`: the visual representation of the graph of the agent
   - `run_functions.ts`: the functions needed for the running of the agent
   - `run_questions.ts`: runs all questions for all LLM models listed, writes one JSON per question

 - `tools/`: the implementation of the tools our agents use
   - `EndpointSparqlTool.ts`: the agent can run SPARQL queries on a given endpoint using this tool
   - `FinalAnswerTools.ts`: if the agent comes to the conclusion of having enough information to form a final answer, it calls this tool to end the run and log the final answer
   - `DecisionLogTool.ts`: the agent logs its decisions to either form a refined query or to give a final answer


### IMPORTANT NOTE: 

Before running, go through all steps of environment and Fuseki setup (detailed in point 1).

### 2.2 Running the agent on the test questions

**Run all SysML questions:**
```bash
npx tsx agent_workflow/run_questions.ts questions/sysml_questions.txt fuseki_endpoints/sysml_endpoint.txt system_prompts/SysML_SystemPrompt.ts
```

**Run all mutated SysML questions:**
```bash
npx tsx agent_workflow/run_questions.ts questions/mutant_questions/sysml_mutant_questions.txt fuseki_endpoints/sysml_endpoint.txt system_prompts/SysML_SystemPrompt.ts
```

**Run all BPMN questions:**
```bash
npx tsx agent_workflow/run_questions.ts questions/bpmn_questions.txt fuseki_endpoints/bpmn_endpoint.txt system_prompts/BPMN_SystemPrompt.ts
```

**Run all mutated BPMN questions:**
```bash
npx tsx agent_workflow/run_questions.ts questions/mutant_questions/bpmn_mutant_questions.txt fuseki_endpoints/bpmn_endpoint.txt system_prompts/BPMN_SystemPrompt.ts
```

By default, the agent runs on all questions with the following LLM models:
  - anthropic/claude-opus-4.6,
  - google/gemini-3.1-flash-lite-preview,
  - qwen/qwen3.5-plus-02-15,
  - openai/gpt-5.4-nano,
  - minimax/minimax-m2.5

Other models can be tried by giving their ChatOpenAI conventional name.

LLM models can be compared here: https://openrouter.ai/compare/


Optionally, a ChatOpenAI conventional name of an LLM model can be given as parameter, so the agent will only run with that model:
```bash
npx tsx agent_workflow/run_questions.ts <questions.txt> <endpoint.txt> <systemPromptFile> [modelName]
```

### 2.3 Output structure

- `automated_test_results/`
  - `<datasetKind>/runs/<runId>/`:  (datasetkind could be sysml or sap-sam-export_aggregated in our case)
    - `questions/`: a JSON run log of all questions
    - `run.meta.json`: meta-level information of the run (LLM modell, question set, tokens etc)


---
## 3) Agent evaluation

### 3.1 Relevant folders and files

- `expected_answers/`
  - `claude-4.6-opus_runs/`: we used our assistants with Claude Opus 4.6 for the base of our expected answers, and we store its run results here
  - `sysml_answers.txt`: expected answers for the SysML questions (also stored in a ``` q001<TAB>Expected answer``` TSV format)
  - `bpmn_answers.txt`: expected answers for the BPMN questions (also stored in a ```q001<TAB>Expected answer``` TSV format)
  - `keywords/`: we store the keywords of the expected answers here for both assistants
  - `model_elements/`: the relevant model element URI-s for the questions of both models

- `evaluation_metrics/`: 
  - `metric_types.ts`: all the implementec metrics have to use this interface
  - `index.ts`: the collection of all the metrics, the ones commented out won't be run
  - `bert_score.ts`: BERT Score based metric
  - `chr_f.ts`: chrF metric
  - `cosine_similarity.ts`: cosine-similarity using sentence-level embedding
  - `keyword_counter_agent.ts`: keyword count using a specific agent
  - `keyword_count_exact_match.ts`: keyword count using sets
  - `llm_judge_majority.ts`: 3 pass/fail judge calls, majority vote
  - `llm_judge_score_avg.ts`: 3 judge scores from 1..5, then average
  - `model_element_uri_metric.ts`: metric measuring model element URI recall and precision
  - `rouge_lf1.ts`: ROUGE F1 metric


 - `agent_evaluation/`:
    - `replace_sid_ids_with_original_id.py`: standardizes model IDs in the run results of the BPMN assistant
    - `meta_data.csv`: the metadata used for standardizing IDs in replace_sid_ids_with_original_id.py
    - `download_embedding_model.ts` - script downloading the embedding model (Xenova/bert-base-cased) used for embedding in BERT Score metric
    - `hf_env.ts`: to keep the embedding model cached in `.cache/transformers/`
    - `keyword_provider.ts`: help get keywords for keyword count based metrics
    - `model_element_provider.ts`: help get model element URI-s for model element URI based metrics
    - `evaluation_config.json`: configuration JSON file helping connect the question sets, endpoints, datasetkinds, expected answers and model element ID file
    - `evaluation_resolver.ts`: resolves the full evaluation context from an existing run.meta.json and the external evaluation_config.json
    - `evaluation_core.ts`: the core logic of evaluating a run of the agent with the metrics
    - `evaluate_run.ts`: evaluating a single run of the agent with the metrics
    - `evaluate_all.ts`: evaluating all runs of the agent on a selected datasetkind (SysML or BPMN in our case) with the metrics
    - `aggregate_results.ts`: aggregating the results into a CSV summary file
    - `create_result_plots.py`: creating plots based on the content of the summary

### 3.2 Evaluating the agent using the metrics

### IMPORTANT NOTE: 
Before evaluating BPMN runs, always run `replace_sid_ids_with_original_id.py`:
```bash
 python3 agent_evaluation/replace_sid_ids_with_original_id.py
```

**Evaluate a specific SysML run:**
```bash
npx tsx agent_evaluation/evaluate_run.ts automated_test_results/sysml/runs/<runId> agent_evaluation/evaluation_config.json
```

**Evaluate a specific BPMN run:**
```bash
npx tsx agent_evaluation/evaluate_run.ts automated_test_results/bpmn/runs/<runId> agent_evaluation/evaluation_config.json
```

**Evaluate all runs under SysML:**
```bash
npx tsx agent_evaluation/evaluate_all.ts automated_test_results/sysml/runs agent_evaluation/evaluation_config.json
```

**Evaluate all runs under BPMN:**
```bash
npx tsx agent_evaluation/evaluate_all.ts automated_test_results/sap-sam-export_aggregated/runs agent_evaluation/evaluation_config.json
```

Optional parameters for `agent_evaluation/evaluate_all.ts`:

- ``` --model <modelName>```: evaluates only the runs with the given LLM model as modelName (for example, "openai/gpt-5.4-nano")
- ``` --questions-file <repo-relative-path>```: evaluates only the runs with the given question file as repo-relative-path (for example, "questions/sysml_questions.txt")


### 3.3 Aggregate evaluations into summary

**Aggregate the latest evaluation of each run:**
```bash
npx tsx agent_evaluation/aggregate_results.ts automated_test_results
```

**Aggregate all evaluations of each run:**
```bash
 npx tsx agent_evaluation/aggregate_results.ts automated_test_results --all
```

### 3.4 Create result plots from summary

```bash
python3 agent_evaluation/create_result_plots.py <summary_dir>
```

Optional parameters: only the the results of selected filters will be plotted
- Dataset kind: 
  - sysml or sap-sam-export_aggregated
  - ``` --datasetkind <value1> <value2>```

- Category: 
  - for SysML: 
    - Junior,
    - Medior,
    - Senior
  - for BPMN:
    - single-model, general,
    - single-model, model-specific,
    - organization, general, generic,
    - organization, general, domain-specific,
    - organization, specific organization, generic
    - organization, specific organization, domain-specific
  - ``` --category <value1> <value2>```

- LLM modell:
  - ``` --llm-model <value1> <value2>```

- Diagram type:
  - can be bar chart, scatter plot, or scatter plot matrix
  - ``` --diagramtype <bar|scatter|matrix>```

### 3.5 Output structure

- `automated_test_results/`
  - `<datasetKind>/runs/<runId>/`:  (datasetkind could be sysml or sap-sam-export_aggregated in our case)
    - `evaluations/`:
      - `<evalID>/`: evaluation happening at the given timestamp 
        - `metrics`: JSONL logs of the score of all metrics measured on the run
        - `manifest.json`: metadata of the evaluation
      - `LATEST.json`: evaluation ID of the latest evaluation of the run
  - `_summary/<summaryID>/`: aggregation of results happening at the given timestamp
    - `metrics_results.csv`: a CSV file aggregating all the metric scores of the summary
    - `plots/<plottingID>/`: plots of the summary happening at the given timestamp
      - `bar`: bar charts
      - `scatter`: scatter plots
      - `matrix`: scatterplot matrix of metrics


## License

Copyright (c) 2026 [The Authors](CONTRIBUTORS.md)

The benchmark is available under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0.txt).

Related artifacts:
- [Thirty Meter Telescope SysML model](https://github.com/Open-MBEE/TMT-SysML-Model/)
  - the SysML model in RDF is available in [`model_databases/TMT`](model_databases/TMT) folder
  - [original SysML model](https://github.com/Open-MBEE/TMT-SysML-Model/blob/master/TMT.mdzip) is available under the [Apache License 2.0](https://github.com/Open-MBEE/TMT-SysML-Model/blob/master/LICENSE)
  - RDF conversion tool: [cameo2rdf](https://github.com/koneksys/cameo2rdf) repo
    - available under the [MIT License](https://github.com/koneksys/cameo2rdf/blob/master/LICENSE)
- BPMN2KG: Business Process Model and Notation to Knowledge Graph: [`converters/bpmn-to-kg/`](converters/bpmn-to-kg/)
  - semantic mapping from BPMN process models to knowledge graph
  - available under the [MIT License](converters/bpmn-to-kg/LICENSE)
- [SAP Signavio Academic Models](https://zenodo.org/records/7012043)
  - available under the [SAP-SAM dataset license](https://zenodo.org/records/7012043)
  - [bpmn-sol-llm-benchmark](https://github.com/fstiehle/bpmn-sol-llm-benchmark/) repo
    - our benchark uses the subset of the SAP-SAM dataset available in the bpmn-sol-llm-benchmark repo
    - related paper: [On LLM Assisted Generation of Smart Contracts from Business Processes](https://dlt4bpm.github.io/assets/papers/BPM_2025_paper_383.pdf)
