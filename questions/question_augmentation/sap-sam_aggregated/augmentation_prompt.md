We got all the questions with Claude 4.6 Opus.

```bash
I am developing an assistant that helps in system-modeling processes, whose goal is to help engineers who ask questions related to the model, 
and the assistant answers these questions based on information extracted from the model. 

The assistant is being tested on the SAP Signavio Academic Models, which are BPMN 2.0 (Business Process Model and Notation 2.0 
- specification available at: https://www.omg.org/spec/BPMN/2.0/PDF) models. These models are aggregated into a single model, with the hierarchy
being: corpus -> organization -> model -> BPMN:Definitions -> BPMN:Choreography -> other BPMN elements. 

The models are related to the domain of business process management, and they are of several different languages, such as English, German, or Polish.

We provide a summary of the rdf:types occuring in the aggregated model in sap-sam_aggregated_types.json, 
and a summary of the bbo:names, rdfs:labels and rdfs:comment of the model (left in the original languages of the models) grouped by
organization and model in sap-sam_aggregated_summary.json.

During the development of the assistant, it is important that we can assess its effectiveness with test questions. The task would be the generation of such test questions.
Separate the generated questions by scope and category.

The scopes:
- questions about a single model,
- questions about organizations. 

The categories for the questions about a single model: 
- general: questions about general BPMN elements and structures, that can be asked about any model.
- model-specific: questions that contain names of model's specific elements, such as name of a task or a participant.

The categories for the questions about organizations:
- general, generic: general questions about the organization corpus that do not include specific information about the domain or the models of the organization.
- general, domain-specific: general questions about the organization corpus that include specific information about the domain or the models of the organization. 
- specific organization, generic: questions about a specific organization that do not include specific information about the domain or the models of the organization.
- specific organization, domain-specific: questions about a specific organization that include specific information about the domain or the models of the organization.

For the generation, you have help from 2 question sets put together by a domain expert.

Question set where the scopre is a single model (expert_questions_models.csv): 5-5 questions abput 10 different models, with the following columns: question_id, question, model_id, category. 
For each model, there are questions from each category.

Question set where the scope is organizations (expert_questions_organizations.csv): the following columns are present: question_id, question, organization_id, category.
For each category, there are questions.

The task: 
Generate 2 new sets of questions, one about single models and one about organizations, following the same style as the questions provided by the domain expert.
For the set about single models: 
- for 20 different models (ID can be found in sap-sam_aggregated_summary.json) generate 5-5 questions, including both generic and model-specific questions.
For the set about organizations: 
- for 5 organizations (ID can be found in sap-sam_aggregated_summary.json) generate 5-5 questions, including questions from both organization-specific category,
- for both general categories, generate 5 questions each.
During the generation, you can use the information about the rdf:types and the names, labels and comments of the elements of the aggregated model provided in sap-sam_aggregated_types.json and sap-sam_aggregated_summary.json.
The questions should be in the same style as the ones provided by the domain expert, and the names of the specific model elements should be in the original language of the models, as they are in the summary.
For each generated question, also generate a variant with a change of wording of the question, including potential spelling errors for the model-specific or organization-specific elements (between ' ' in the original questions), but keeping the same meaning.
At the end of each question, where the category is NOT general, or the question is NOT about finding out which model it is, include a "(Model ID: model_id)" or "(Organization ID: organization_id)" to indicate the model or organization the question is about, as it is done in the expert questions.

Format the output as the following guide:
Scope: single model:
question id (qXXX, starting from 001);question (put model ID at the end);question variant (the generated variant, also include model ID at the end);original_model_id (modelOriginalId from the summary);name (modelName from the summary);organization_id (organizationId from the summary);category (general or model-specific)
---Separator---
Scope: organization:
question id (qXXX, starting from 001);question (Organization ID at the end if not general);question variant (the generated variant, also include organization ID at the end if not general);organization_id (organizationId from the summary);category (general, generic or general, domain-specific or specific organization, generic or specific organization, domain-specific)
```