We got the first batch of questions with ChatGPT 5.2 Thinking, the second batch with Claude 4.6 Opus.

```bash
I am developing an assistant that helps in system-modeling processes, whose goal is to help engineers who ask questions related to the model, and the assistant answers these questions based on information extracted from the model. The assistant is being tested on the development project of the Thirty Meter Telescope. During the development of the assistant, it is important that we can assess its effectiveness with test questions. The task would be the generation of such test questions. Separate the generated questions by category. The categories are the assistant’s use cases:
- requirements traceability
- navigation in the model
- onboarding, knowledge transfer
- searching for errors, anomalies.

For the generation, you have help from a question set put together by an engineer working on the project (Robert Karban) (attached robert_kerdesek_fejleszteskor.txt file), and also a JSON file each that contains the model’s blocks and packages (blockok.json and packagek.json). In the engineer’s question set, the questions represent several different difficulty levels: junior, medior, and senior. The junior wants to find out basic, high-level information about the model, the medior is already curious about somewhat more direct, lower-level information, and the senior asks about low-level, implementation-detail-related information. In each category generate 2 junior, 2 medior, and 2 senior difficulty questions. The questions should follow the style of the engineer’s questions: they should be of similar length, complexity, and form. The questions should be answerable in text. Formulate the questions in English. Make a .txt file in which you list the questions grouped by category, and within that by difficulty.
```