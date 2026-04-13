// Keep the same indexing convention: q001 -> [0], q002 -> [1], ...
export const KEYWORDS_BPMN: string[][] = [
  // q001: The model "A-A 2" (Model ID: `2f572d235e784b838fa0d7d2a56748ab`) contains 13 choreography tasks.
  ["13", "choreography tasks", "A-A 2", "2f572d235e784b838fa0d7d2a56748ab"],
  // q002: No, there are no unreachable tasks... all 13 are reachable from the start event
  ["no", "unreachable tasks", "13", "reachable", "start event", "sequence flow", "initial node"],
  // q003: There are 2 models that contain a "Data analysis" choreography task with both participants "The Client EHQ" and "The Client ELC"
  ["2", "models", "Data analysis", "choreography task", "The Client EHQ", "The Client ELC", "C_A choreography final", "A-A 2"],
  // q004: task between "Process provisioning" and "Operations provisioning" is "Service provisioning"
  ["Service provisioning", "Process provisioning", "Operations provisioning", "Choreography Task", "2f572d235e784b838fa0d7d2a56748ab"],
  // q005: 2 choreography tasks that have relations to multiple messages
  ["2", "choreography tasks", "multiple messages", "Order provisioning", "Pre-return management", "Order request", "Order confirmation", "Return label request", "Return label"],
  // q006: No — all tasks are reachable from the initial (start) node
  ["no", "all tasks", "reachable", "initial", "start node"],
  // q007: No, there is no parallelism in the model "Anfrage Bildungsträger"
  ["no", "parallelism", "Anfrage Bildungsträger", "1ad939eef40c461dafae27f75a0586d3"],
  // q008: Yes, there is cyclic behaviour... 4 nodes participate in a structural loop
  ["cyclic behaviour", "Anfrage Bildungsträger", "1ad939eef40c461dafae27f75a0586d3", "4", "nodes", "structural loop", "Angebot versenden", "Ergänzende Wünsche?", "Wünsche zusenden", "ExclusiveGateway"],
  // q009: "Wünsche zusenden" is contained in "Anfrage Bildungsträger", participants: Kunde, Bildungsträger
  ["Wünsche zusenden", "Anfrage Bildungsträger", "Kunde", "Bildungsträger", "Initiating participant", "Non-initiating participant"],
  // q010: Issue 1: Unnamed Start/End Event, Issue 2: 4 Message Elements empty names, Issue 3: Unnamed Exclusive Gateway
  ["Unnamed StartEvent", "EndEvent", "empty names", "4", "Message", "Exclusive Gateway", "Converging"],
  // q011: Yes, there is one Exclusive Gateway in "Koreografija"
  ["1", "Exclusive Gateway", "Koreografija", "2aa476e4bbdf451083ec316570f7a3be", "sid-59961FB6-4733-4F3E-88C7-A469AAFB0734", "unnamed", "Diverging"],
  // q012: Yes, "Opis resenja problema" is always reachable from start node
  ["Opis resenja problema", "always reachable", "start node", "2aa476e4bbdf451083ec316570f7a3be"],
  // q013: model "Koreografija" contains 6 messages
  ["Koreografija", "2aa476e4bbdf451083ec316570f7a3be", "6", "messages", "Problem", "Zahtev za detaljnim opisom problema", "Detaljan opis problema", "Resenje problema"],
  // q014: No, there is no parallelism in this model
  ["no", "parallelism", "2aa476e4bbdf451083ec316570f7a3be"],
  // q015: "Trenutak dobijanja detaljnog opisa problema" belongs to "Koreografija"
  ["Trenutak dobijanja detaljnog opisa problema", "ChoreographyTask", "Koreografija", "https://www.teamingai-project.eu/kg/model/sid_edab148c_8f79_4e08_b9b1_b11f3b1a0c1f"],
  // q016: Yes, 'Lasku' is always executed after 'Merkitse varaus'
  ["Lasku", "always executed", "Merkitse varaus", "Asiakas saapuu ravintolaan", "Tilaus", "Ruokailu"],
  // q017: message "Asiakas tilaa ruoan" is found in "Koreografiakaavio", Org17
  ["Asiakas tilaa ruoan", "message", "Koreografiakaavio", "Org17"],
  // q018: No, 'Ruokailu' is not always executed - conditional on Exclusive Gateway
  ["no", "Ruokailu", "not always executed", "Exclusive Gateway", "conditionally executed"],
  // q019: model contains 10 sequence flows
  ["10", "sequence flows", "6e8e145a4f51488c81c0c89e863a27fa"],
  // q020: Yes, there is cyclic behaviour: Beratung → ExclusiveGateway → Beratung
  ["cyclic behaviour", "Beratung", "ExclusiveGateway"],
  // q021: Not necessarily — loop means termination depends on runtime evaluation
  ["not necessarily", "no", "loop", "EndEvent", "termination", "runtime evaluation", "gateway condition"],
  // q022: "Bezahlvorgang" belongs to "Choreographie Einkauf im Fachhandel"
  ["Bezahlvorgang", "Choreography Task", "Choreographie Einkauf im Fachhandel", "https://www.teamingai-project.eu/kg/model/sid_d8d3781e_3b5a_4864_8c2e_da05b5b75a2b"],
  // q023: Yes, 'Beratung' is always reachable from 'Kaufwunsch'
  ["Beratung", "always reachable", "Kaufwunsch", "unconditional sequence flow", "no gateway"],
  // q024: No, 'Bezahlvorgang' is not always reachable from 'Beratung' - loop via XOR gateway
  ["no", "Bezahlvorgang", "not always reachable", "Beratung", "loop", "XOR gateway"],
  // q025: "Get client to add the relevant cost centre" involves SSP and Client, 2 messages
  ["Get client to add the relevant cost centre", "2d887704e5324e6bb2126cef061e50e9", "SSP", "Client", "2", "messages", "Request client to add more information", "Client send more Information"],
  // q026: No, there is no parallelism
  ["no", "parallelism", "2d887704e5324e6bb2126cef061e50e9"],
  // q027: 2 choreography tasks between "Receive invoice" and "Check invoice completeness"
  ["2", "choreography tasks", "Receive invoice", "Check invoice completeness", "Get Confirmation for invoice that can be paid", "Get client to add the relevant cost centre"],
  // q028: Yes, choreography will always reach an end node
  ["always reach", "end node", "Exclusive Gateway", "XOR", "EndEvent"],
  // q029: condition label `conditions & 1 == 1` is placeholder/dummy
  ["Informieren über Zustimmung", "sequence flow", "conditions & 1 == 1", "placeholder", "dummy expression"],
  // q030: No, "Informieren über Zustimmung" is NOT always reachable - XOR gateway
  ["no", "Informieren über Zustimmung", "not always reachable", "Exclusive Gateway", "XOR", "conditions & 1 == 1"],
  // q031: "Informieren über Zustimmung" belongs to "Aufgabe 1: 4 Augen-Prüfung", Org52
  ["Informieren über Zustimmung", "Choreography Task", "Aufgabe 1: 4 Augen-Prüfung", "Org52"],
  // q032: model contains 3 choreography tasks
  ["3", "choreography tasks", "Aufgabe 1: 4 Augen-Prüfung", "4ccc3fd711004f519782ac92e58f6ddd", "Schickt Antragsformular ab", "Informieren über Zustimmung", "Informieren über Ablehnung"],
  // q033: 5 choreography tasks have "Customer" as participant
  ["5", "choreography tasks", "Customer", "participant", "3c1c7ac2bf4042fe9cd4ed34ce14a188", "Customer reports problem", "End the call with a good note", "Analyze Problem and tryout different solutions", "Record time and incident report in service form", "Solve the customer problem on-site"],
  // q034: No, "Record time..." cannot happen before "End the call..." - mutually exclusive branches
  ["no", "Record time and incident report in service form", "cannot happen before", "End the call with a good note", "mutually exclusive", "Exclusive Gateway", "XOR", "Problem solved?"],
  // q035: "Explain service Technician about problem" belongs to "4b Choreography AsIs IT Service"
  ["Explain  service Technician about problem", "ChoreographyTask", "4b Choreography AsIs IT Service", "3c1c7ac2bf4042fe9cd4ed34ce14a188"],
  // q036: No, there are no unreachable tasks
  ["no", "unreachable tasks", "all tasks", "reachable", "start node"],
  // q037: 2 choreography tasks have exactly 2 related messages
  ["2", "choreography tasks", "2 messages", "3c1c7ac2bf4042fe9cd4ed34ce14a188", "Record time and incident report in service form", "Service Form", "Sign the form", "Solve the customer problem on-site", "Solution", "Acknowledgement"],
  // q038: Yes, there is parallelism - fork-join parallel pattern, Parallel Gateways
  ["parallelism", "fork-join", "parallel pattern", "2", "Parallel Gateways", "AND gateways"],
  // q039: Yes, task 'M5' is always reachable from start node
  ["M5", "always reachable", "start node", "0b4394edaa09437d93cc54c78c0180cb"],
  // q040: participants A, B, C - multiple instances across different choreography tasks
  ["participants", "A", "B", "C", "multiple instances", "choreography tasks"],
  // q041: All five tasks (M1-M5) are on valid execution paths, none unreachable
  ["M1", "M2", "M3", "M4", "M5", "all", "valid execution paths", "Start Event", "no", "unreachable"],
  // q042: Yes, M5 always reachable from M1 - Parallel Gateways, no conditional branching
  ["M5", "always reachable", "M1", "Parallel Gateways", "no", "conditional branching"],
  // q043: 4 distinct execution paths, 2 XOR gateways × 2 branches = 4
  ["4", "distinct execution paths", "2", "Exclusive", "XOR", "gateways"],
  // q044: No, 'Absage senden' is not always executed
  ["no", "Absage senden", "not always executed", "Zusagen senden"],
  // q045: all 5 choreography tasks have both Hochschule and Bewerber as participants
  ["5", "choreography tasks", "Hochschule", "Bewerber", "participants", "fbb0adafe6924f58ac902063a36646fe", "Absage senden", "Bewerbungsunterlagen und Eingangsbestätigung senden", "Fehlende Unterlagen anfordern", "Fehlende Unterlagen senden", "Zusagen senden"],
  // q046: model contains 12 sequence flows
  ["12", "sequence flows", "fbb0adafe6924f58ac902063a36646fe"],
  // q047: model "Choreographiediagramm" contains 24 choreography tasks
  ["24", "choreography tasks", "Choreographiediagramm", "1f1b01e0a85340689b6df314b32bb4b6"],
  // q048: No unreachable tasks, all 24 reachable from start event
  ["no", "unreachable tasks", "24", "reachable", "start event"],
  // q049: Yes, parallelism - 1 Parallel Gateway "Einigung gefunden?" Diverging
  ["parallelism", "1", "Parallel Gateway", "AND gateway", "Einigung gefunden?", "Diverging"],
  // q050: "Anzeigeformular ausfüllen" in "Choreographiediagramm"
  ["Anzeigeformular ausfüllen", "Choreographiediagramm", "https://www.teamingai-project.eu/kg/model/sid_57deb9e0_f5ba_4380_a35e_0656d288167a"],
  // q051: No, 'Anfrage für Formular' NOT always reachable - bypass at 'Erneut versuchen?' gateway
  ["no", "Anfrage für Formular", "not always reachable", "start node", "Erneut versuchen?", "Exclusive Gateway", "End Event"],
  // q052: Yes, cyclic behaviour - counter-based retry loop, up to 3 iterations
  ["cyclic behaviour", "counter-based", "retry loop", "3", "iterations", "i = i + 1", "7", "choreography tasks", "5", "exclusive gateways"],
  // q053: Yes, always reach end node - loops governed by exclusive gateways, "i = 3 ?" bounded loop counter
  ["always reach", "end node", "exclusive gateways", "exit conditions", "i = 3 ?", "bounded loop counter"],
  // q054: "Eingang bestätigen" found in "Choreographiediagramm (Kopie)"
  ["Eingang bestätigen", "Choreographiediagramm (Kopie)", "ChoreographyTask", "2d225c9ff86b443c9f6bc6cfe687afbc"],
  // q055: No, "Probe ausliefern" not always executed - behind XOR Gateways
  ["no", "Probe ausliefern", "not always executed", "Exclusive", "XOR", "Gateways", "conditionally executed", "bestanden"],
  // q056: model "C-A Interaction" contains 14 sequence flows
  ["14", "sequence flows", "C-A Interaction", "1dccc40d34ef40f9b36123e2fbca1a63"],
  // q057: model contains 15 messages
  ["15", "messages", "C-A Interaction", "1dccc40d34ef40f9b36123e2fbca1a63", "Transport order", "Decision matrix", "Return label", "Order confirmation", "Live shipment information", "Inventory levels", "Item level decisions", "Refund trigger", "Order request", "Item grades", "Transport details", "Parcel item(s) list", "Shipment details", "Order update", "Packing requirements"],
  // q058: model contains 4 distinct participants
  ["4", "participants", "C-A Interaction", "1dccc40d34ef40f9b36123e2fbca1a63", "Cycleon", "Jane Doe", "DPD", "Yusen (RRC UK)"],
  // q059: "Transportation provisioning" is actually a Choreography Task, not a Message
  ["Transportation provisioning", "Choreography Task", "1dccc40d34ef40f9b36123e2fbca1a63", "no", "Message"],
  // q060: Yes, model contains 7 Exclusive Gateways
  ["7", "Exclusive Gateways", "5ee15f85aeb74d8d9e31df0e41fea6fe"],
  // q061: 2 choreography tasks with multiple messages: Pay bike, Pay insurance
  ["2", "choreography tasks", "multiple messages", "Pay bike", "payment1()", "voucher(string voucherData)", "Pay insurance", "insurance(string insuranceData)", "payment0()"],
  // q062: "InsuranceReq==true" is a SequenceFlow (conditional flow edge), not a ChoreographyTask
  ["InsuranceReq==true", "SequenceFlow", "conditional flow", "Bike rental spezzato", "Org35", "not", "ChoreographyTask"],
  // q063: after "Estimate insurance cost" comes "Pay insurance"
  ["Estimate insurance cost", "Pay insurance", "Send receipt", "5ee15f85aeb74d8d9e31df0e41fea6fe"],
  // q064: Yes, all tasks are executable in "BallBearing RESTful choreography (three servers)"
  ["all tasks", "executable", "BallBearing RESTful choreography (three servers)", "3c08e52742754da6a4065fc5787131dc", "well-structured"],
  // q065: 3 choreography tasks have multiple names - naming confusion
  ["3", "choreography tasks", "multiple names", "sid-40B088FB", "Send payment", "Confirm order", "Request for Tender", "sid-84676F3C", "Place order", "Send purchase contract", "sid-DB2E0E83", "Confirm payment", "Fulfill order"],
  // q066: 5 distinct execution paths, loop means payment step can be retried
  ["5", "distinct execution paths", "loop", "payment", "retried", "3c08e52742754da6a4065fc5787131dc"],
  // q067: "Manufacturer" exists as Participant across 8 models
  ["Manufacturer", "Participant", "8", "models", "Choreography_Manufacturer_Alt3 (Copy)", "Choreography_gemeinsam", "Part procurement choreography (final solution)", "Part procurement choreography D (blockchain motivation)", "BallBearing RESTful choreography (one server at a time)", "BallBearing RESTful choreography (three servers)", "Purchase Ballbearings", "E_enforcability"],
  // q068: "Payment Org." participates in 4 choreography tasks
  ["Payment Org.", "4", "choreography tasks", "3c08e52742754da6a4065fc5787131dc", "Confirm payment", "Fulfill order", "Send \"payment failed\" message", "Pay order", "Initiating Participant", "Non-Initiating Participant"],
  // q069: 9 choreography tasks have exactly 2 related messages
  ["9", "choreography tasks", "2", "messages", "1cd93309017949fdbebf0f7d7ea50b4a", "access contact us page and send issues", "check return car list", "give normal access", "give staff access", "interacted by homepage", "login", "manage employees", "manage users", "search car"],
  // q070: model has 1 start event: "normal Users are coming to the website"
  ["1", "start event", "normal Users are coming to the website", "1cd93309017949fdbebf0f7d7ea50b4a"],
  // q071: Yes, model contains 2 event-based gateways
  ["2", "event-based gateways", "1cd93309017949fdbebf0f7d7ea50b4a", "sid-0F7B0F2A-347E-44F9-A210-B32B8CC2E0CB", "sid-771ED2AA-3718-491D-A68D-C931063229EA", "Diverging"],
  // q072: "staff access user" participant in "299 chereography"
  ["staff access user", "participant", "299 chereography", "1cd93309017949fdbebf0f7d7ea50b4a"],
  // q073: "Car is returned" is an EndEvent, no messages
  ["Car is returned", "EndEvent", "no", "messages", "1cd93309017949fdbebf0f7d7ea50b4a"],
  // q074: model has 6 distinct participants
  ["6", "participants", "0ba102e82f484407a4dbcb9bcafdd920", "University", "Candidate", "Academic Agency", "Admissions Officer", "Admission Committee", "Admissions Committee"],
  // q075: model contains 15 choreography tasks (listed)
  ["15", "choreography tasks", "A2 Section 1 choreo", "0ba102e82f484407a4dbcb9bcafdd920", "Confirm Rejection", "Email Results of Academic Review", "Forward Application", "Post Academic Documents", "Reply to offer", "Resubmit Application", "Send Application Results", "Send PDF", "Send acceptance offer", "Send admissible email", "Send hard copy of application and documents", "Send rejection email", "Send scholarship offer", "Submit Online Application"],
  // q076: model contains 15 choreography tasks
  ["15", "choreography tasks", "0ba102e82f484407a4dbcb9bcafdd920"],
  // q077: "Submit Online Application" in "A2 Section 1 choreo"
  ["Submit Online Application", "Choreography Task", "A2 Section 1 choreo", "https://www.teamingai-project.eu/kg/model/sid_1e54f458_a99d_4967_baa4_929c6fb5c8af"],
  // q078: No, "Forward Application" cannot happen before "Email Results of Academic Review"
  ["no", "Forward Application", "cannot happen before", "Email Results of Academic Review", "Post Academic Documents"],
  // q079: No, there are no unreachable tasks
  ["no", "unreachable tasks"],
  // q080: Yes, parallelism - 2 Parallel Gateways forming parallel block
  ["parallelism", "2", "Parallel Gateways", "parallel block"],
  // q081: No cyclic behaviour
  ["no", "cyclic behaviour", "5a8e825c3a9a4049b67ab53c2ba7abc8"],
  // q082: "modification to natural environment" is a SequenceFlow in "Chapter 4 exercise 4.33", Org63
  ["modification to natural environment", "SequenceFlow", "Chapter 4 exercise 4.33", "Org63"],
  // q083: tasks on two separate parallel branches between Parallel Gateways
  ["Request a land alteration permit", "Grant license", "parallel branches", "Parallel Gateway", "diverging", "converging"],
  // q084: No, could loop indefinitely - retry loops at "Login-Daten korrekt?" and "Fehler?"
  ["no", "loop indefinitely", "retry loops", "Login-Daten korrekt?", "Fehler?"],
  // q085: model contains 1 end event
  ["1", "end event", "4e8df28e6d9f4afe970d06522542e830"],
  // q086: model contains 22 sequence flows
  ["22", "sequence flows", "4e8df28e6d9f4afe970d06522542e830"],
  // q087: "Suchanfrage" in "12345678", Org68
  ["Suchanfrage", "12345678", "Org68"],
  // q088: Yes, 'Buch in Warenkorb' always reachable from start node
  ["Buch in Warenkorb", "always reachable", "start node"],
  // q089: 10 messages listed
  ["10", "messages", "6c9090aeef814120944b4885c7343b63", "Order details & customers address", "Order details", "Order is ready", "Customers & restaurant address", "Alert about drivers arrival", "Feedback form", "Customers Complaint", "Estimated preparation time"],
  // q090: 4 distinct participants
  ["4", "participants", "Customer", "Pyszne.pl", "Restaurant", "Uber Eats"],
  // q091: Yes, 4 Exclusive Gateways (XOR)
  ["4", "Exclusive Gateways", "XOR", "6c9090aeef814120944b4885c7343b63"],
  // q092: "Take order from the restaurant & deliver it" found in Jane Doe_ZAMAWIANIE... model, Org2
  ["Take order from the restaurant & deliver it", "ChoreographyTask", "Org2", "Pyszne.pl", "Uber Eats"],
  // q093: No, "Complaint rejected" not always executed - Exclusive Gateway
  ["no", "Complaint rejected", "not always executed", "Exclusive Gateway", "Reject condition"],
  // q094: model contains 15 messages (listed)
  ["15", "messages", "4ac969819d6749d495c4f3be5f4745de", "Applicants notification", "Offer acceptance and rejection notification", "Ranking list submission", "Offer acceptance", "Admission notice", "Notification email", "Application rejection", "Verified application", "Rejected application", "Resubmission confirmation", "Application submission", "Acceptance and rejection notices", "Offer rejection", "Application received"],
  // q095: 5 choreography tasks with multiple messages (2 each)
  ["5", "choreography tasks", "multiple messages", "2", "4ac969819d6749d495c4f3be5f4745de", "Confirmation of applicants", "Notify Applicants", "Receive documents", "Reject application", "Applications verified"],
  // q096: Yes, all tasks executable
  ["all tasks", "executable", "4ac969819d6749d495c4f3be5f4745de"],
  // q097: "Reject application" in "Choreography", Org19
  ["Reject application", "Choreography Task", "Choreography", "Org19", "https://www.teamingai-project.eu/kg/model/sid_7e6c8e81_8977_4cbd_818d_dec74bfc816b"],
  // q098: 'Application received' reachable from 'Receive documents' only conditionally via XOR
  ["Application received", "reachable", "Receive documents", "not always", "XOR gateway", "conditionally"],
  // q099: Spelling errors: "Produkstart" should be "Produktstart", "Eingenschaften" should be "Eigenschaften"
  ["Spelling Errors", "Informationen über Produkstart", "Produktstart", "Material, Eingenschaften", "Eigenschaften"],
  // q100: 4 distinct execution paths, 2 XOR gateways × 2 = 4
  ["4", "distinct execution paths", "2", "Exclusive", "XOR", "Gateways"],
  // q101: None of the tasks have 2 related messages
  ["no", "tasks", "2", "related messages"],
  // q102: "für unbekannte Daten passende, analoge Materialien finden" in two models
  ["für unbekannte Daten passende, analoge Materialien finden", "2", "models", "Neues Produkt V1.0", "Neues Produkt V1.0 (Kopie)"],
  // q103: task between the two named tasks is "benötigte Rohstoffe..."
  ["benötigte Rohstoffe, Bezeichnung, interne Materialnummer für Rohstoffe erfragen", "3d0f07f9b84c4e31bbca562f472c8885"],
  // q104: No, model does not contain event-based gateways
  ["no", "event-based gateways"],
  // q105: model contains 24 participant instances with 7 unique participant names
  ["24", "participant instances", "7", "unique participant names", "izdavanje kartice student, DOMACI", "0cad2ceffcad428aab5664a733b078e6"],
  // q106: "preuzimanje gotove kartice" in "izdavanje kartice student, DOMACI"
  ["preuzimanje gotove kartice", "izdavanje kartice student, DOMACI", "https://www.teamingai-project.eu/kg/model/sid_48bc8f06_fc71_4dd2_b520_ae758d6acf82"],
  // q107: "obavestavanje studenta" is a choreography task name, not a participant, 2 tasks matching
  ["obavestavanje studenta", "choreography task", "not", "participant", "2", "0cad2ceffcad428aab5664a733b078e6"],
  // q108: model contains 8 choreography tasks (listed)
  ["8", "choreography tasks", "Choreography diagram (fixed)", "1c273a0818b146269ac04f6b8d518698", "Ask for renting a device", "Redirect to external payment system", "Send back the rented device", "Send device's results", "Send medical device", "Send the diagnose to the customer", "Send the results to the doctor and get back the diagnose", "Transaction"],
  // q109: model contains 8 choreography tasks
  ["8", "choreography tasks", "Choreography diagram (fixed)", "1c273a0818b146269ac04f6b8d518698"],
  // q110: All nodes reachable from initial node
  ["all nodes", "reachable", "initial node"],
  // q111: Yes, parallelism - 2 Parallel Gateways, AND, fork-and-join
  ["parallelism", "Urlaubsantrag", "2", "Parallel Gateways", "AND gateways", "fork-and-join"],
  // q112: No cyclic behavior
  ["no", "cyclic behavior", "0b21c69687b64d8886fb7cc5dc56ff6c"],
  // q113: Yes, always reach end node
  ["always reach", "end node"],
  // q114: "genehmigten und unterzeichneten Antrag zurücksenden" belongs to "UrlaubsantragChoreographiediagrammV2"
  ["genehmigten und unterzeichneten Antrag zurücksenden", "UrlaubsantragChoreographiediagrammV2"],
  // q115: No, "genehmigten uund unterzeichneten Urlaubsantrag weiterleiten" cannot happen before "ausgefüllten und unterschriebenen Urlaubsantrag senden"
  ["no", "genehmigten uund unterzeichneten Urlaubsantrag weiterleiten", "cannot happen before", "ausgefüllten und unterschriebenen Urlaubsantrag senden"],
  // q116: model contains 20 sequence flows
  ["20", "sequence flows", "4fba0078103d44d9846d4fbec51710cb"],
  // q117: model contains no messages
  ["no", "messages"],
  // q118: 'Przygotowanie umowy' in "Wypożyczalnia samochodów choerogafia"
  ["Przygotowanie umowy", "Wypożyczalnia samochodów choerogafia", "https://www.teamingai-project.eu/kg/model/sid_55e03d8a_7ec7_4221_a353_afe03bfcd155"],
  // q119: 2 choreography tasks between the two named tasks
  ["2", "choreography tasks", "Wybiera samochód oraz czas najmu", "Przygotowuje nową umowe lub zostaje przy poprzedniej", "Podaje cenę za wypożycznie", "Przygotowanie umowy"],
  // q120: model has 3 distinct participants
  ["3", "participants", "Werbeagentur Choreographiediagramm", "2b18c5f00a5a46159c6cb6a3e2bc79e9", "Grafiker", "Kunde", "Werbeagentur"],
  // q121: Yes, 4 Exclusive Gateways (XOR)
  ["4", "Exclusive Gateways", "XOR", "Werbeagentur Choreographiediagramm", "2b18c5f00a5a46159c6cb6a3e2bc79e9"],
  // q122: model contains 11 messages
  ["11", "messages", "Werbeagentur Choreographiediagramm", "2b18c5f00a5a46159c6cb6a3e2bc79e9"],
  // q123: 'Absage' is a task in model "choreography", Org18
  ["Absage", "task", "choreography", "Org18", "https://www.teamingai-project.eu/kg/model/sid_c73a6fe0_6a40_4666_9364_6836ff009bab"],
  // q124: No, tasks with 'Auftrag' not always reachable from start node
  ["no", "Auftrag", "not always reachable", "start node", "execution paths", "bypass"],
  // q125: model doesn't have any messages
  ["no", "messages"],
  // q126: all 12 choreography tasks reachable from start event
  ["12", "choreography tasks", "all", "reachable", "start event"],
  // q127: 2 participants with empty names
  ["2", "participants", "empty names", "sid-1206A89E", "sid-A8EB5DDD", "prüft Artikel", "inseriert Artikel", "message flows"],
  // q128: "Auktionshaus" is found in "Auktionshaus_Online" but it's a participant
  ["Auktionshaus", "Auktionshaus_Online", "262d9e9b8c224d918fe800cd2a454ddf", "participant"],
  // q129: No, "werden über Artikel per Email informiert" NOT always executed - XOR
  ["no", "werden über Artikel per Email informiert", "not always executed", "Exclusive Gateway", "XOR"],
  // q130: 4 possible execution paths, 2 XOR Gateways × 2 branches
  ["4", "execution paths", "2", "Exclusive", "XOR", "Gateways", "01e9c28ede6a4695b91dd90b3e0c5f1b"],
  // q131: 3 choreography tasks have exactly 2 related messages
  ["3", "choreography tasks", "2", "messages", "01e9c28ede6a4695b91dd90b3e0c5f1b", "codice fiscale request", "insert prescription data", "request recipe form"],
  // q132: model has 1 start event
  ["1", "start event", "01e9c28ede6a4695b91dd90b3e0c5f1b"],
  // q133: model "Doctor-patient recipe" contains "send doctor credentials" task and "credentials" message
  ["Doctor-patient recipe", "01e9c28ede6a4695b91dd90b3e0c5f1b", "send doctor credentials", "credentials", "message"],
  // q134: Yes, 'send doctor credentials' always reachable from 'recipe request'
  ["send doctor credentials", "always reachable", "recipe request", "directly"],
  // q135: Yes, model "choreo" contains 1 event-based gateway
  ["1", "event-based gateway", "choreo", "f404135647444aedabe98bb54c000517"],
  // q136: model "choreo" has 4 distinct participants
  ["4", "participants", "choreo", "f404135647444aedabe98bb54c000517", "Applicant", "University", "Postal Service", "Postal"],
  // q137: model "choreo" contains 11 choreography tasks (listed)
  ["11", "choreography tasks", "choreo", "f404135647444aedabe98bb54c000517", "Accept Offer", "Apply for admission", "Cancel Application", "Decline offer", "Post PDF and certified transcripts", "Receive Appropriate Letter", "Receive PDF and certified transcripts", "Send Appropriate Letter", "Send PDF", "Send notifications", "Submit documents"],
  // q138: "Applicant information" found in "choreo" but it's a message
  ["Applicant information", "choreo", "https://www.teamingai-project.eu/kg/model/sid_c4417a54_a50e_4ff3_83f7_0ffc13671109", "message"],
  // q139: tasks between "Send notifications" and "Cancel Application"
  ["Submit documents", "Send PDF", "Post PDF and certified transcripts", "EventBasedGateway", "Cancel Application"],
  // q140: organization contains 5 models
  ["5", "models", "4d36ddb24c9e4cc38572abbd646c1e58"],
  // q141: models in Org25 are German
  ["German", "Org25", "4d36ddb24c9e4cc38572abbd646c1e58"],
  // q142: "Reisebüro (Kopie)" belongs to Org25
  ["Reisebüro (Kopie)", "Org25", "4d36ddb24c9e4cc38572abbd646c1e58"],
  // q143: Org52 has 25 models, only org with that count
  ["25", "models", "Org52", "985f88f59e8b4962a0a2c2fec001b6d1", "only organization"],
  // q144: model creation dates, time difference 6h 37m 43s
  ["2019-05-02", "10:21:47", "16:59:30", "6 hours", "37 minutes", "43 seconds", "4d36ddb24c9e4cc38572abbd646c1e58"],
  // q145: Org68 has the most models, 40
  ["Org68", "most models", "40", "c41660388a04449a995dccf97d894f46"],
  // q146: Org52 has earliest model creation date, "Aufgabe 1: 4 Augen-Prüfung", 2015-11-20
  ["Org52", "earliest", "model creation date", "985f88f59e8b4962a0a2c2fec001b6d1", "Aufgabe 1: 4 Augen-Prüfung", "2015-11-20", "11:09:01"],
  // q147: 4 organizations with between 5 and 10 models
  ["4", "organizations", "5", "10", "models", "1c0ca074f62d457cad311a2ab2a3d6b5", "1fcd4973039d4c648b9c4535154699d4", "fcb09822983f4723b0799941e76e9c60", "4d36ddb24c9e4cc38572abbd646c1e58"],
  // q148: 2 organizations with restaurant models: Org2 and Org53
  ["2", "organizations", "restaurants", "Org2", "009c2b4d8d3c4a01914963ada47c167e", "Org53", "986027b9455f48fd81c81316f4bb882e"],
  // q149: 2 organizations with university models, "University" participant
  ["2", "organizations", "universities", "University", "participant", "Org92", "f6349eddf2cd4db2807e484375e66687", "Org97", "fe334b3d8ec449938b4f3db5e5eac22e"],
  // q150: 5 models containing travel agency ("Reisebüro") tasks
  ["5", "models", "Reisebüro", "choreography tasks", "4d36ddb24c9e4cc38572abbd646c1e58", "2e7d7f7d8e394d5c9915951da979159f", "fdbabf2c73c249729c94699f21c1b41a", "4ca225a6fabf475682588d60850edbd7", "3e8454e9c46745d8adac9dd8ab91bbf4", "fd06b9038279475db06a729386d36335"],
  // q151: 5 models include parallel execution (Parallel Gateways)
  ["5", "models", "parallel execution", "Parallel Gateways", "4d36ddb24c9e4cc38572abbd646c1e58", "3e8454e9c46745d8adac9dd8ab91bbf4", "fdbabf2c73c249729c94699f21c1b41a", "2e7d7f7d8e394d5c9915951da979159f", "4ca225a6fabf475682588d60850edbd7", "fd06b9038279475db06a729386d36335"],
  // q152: 16 occurrences of 7 different participants across 4 models
  ["16", "occurrences", "7", "participants", "4", "models", "Fluggesellschaft", "Flugkette 1/2", "Fluggesellschaft/Hotelkette", "Fluggesellschaft 1", "Fluggesellschaft 2", "Flugeselschaften", "Fluggeselschasft"],
  // q153: German-language university course/study group focused on BPM, travel agency booking scenario
  ["German-language", "university course", "Business Process Modeling", "travel agency", "booking", "BPMN choreography", "Org25"],
  // q154: customers ("Kunde"/"Kunden") have the least tasks, 6 tasks each
  ["Kunde", "Kunden", "least", "6", "tasks", "Übung 7 Aufgabe 1", "3e8454e9c46745d8adac9dd8ab91bbf4", "fd06b9038279475db06a729386d36335"],
  // q155: No sole profile for Org20, 12 models, 5 distinct business domains
  ["no", "sole profile", "Org20", "38b17e822a5e4307ae051694293e4d0f", "12", "models", "5", "distinct business domains"],
  // q156: 4 models contain tasks related to making offers
  ["4", "models", "choreography tasks", "offers", "38b17e822a5e4307ae051694293e4d0f", "Choreography", "Travel Agency", "Travel Agency Choreography"],
  // q157: 4 models contain financial-related choreography tasks
  ["4", "models", "financial-related", "choreography tasks", "38b17e822a5e4307ae051694293e4d0f", "Choreography", "Travel Agency", "Travel Agency Choreography"],
  // q158: 2 models related to organ transportation, Polish
  ["2", "models", "organ transportation", "38b17e822a5e4307ae051694293e4d0f", "Jane Doe_2", "Wilk_Jane Doe_2", "Polish"],
  // q159: 12 models written in mix of Polish and English
  ["12", "models", "38b17e822a5e4307ae051694293e4d0f", "Org20", "Polish", "English"],
  // q160: Service-Techniker needed when problem cannot be resolved remotely
  ["Service-Techniker", "cannot resolved remotely", "Hotline", "Disponent", "on-site", "customer"],
  // q161: Org68 has most models, 40
  ["Org68", "most models", "40"],
  // q162: Org52 has earliest model creation date, "Aufgabe 1: 4 Augen-Prüfung", 2015-11-20
  ["Org52", "earliest", "model creation date", "Aufgabe 1: 4 Augen-Prüfung", "2015-11-20", "11:09:01"],
  // q163: 4 organizations with between 5 and 10 models
  ["4", "organizations", "5", "10", "models", "Org13", "1c0ca074f62d457cad311a2ab2a3d6b5", "Org16", "1fcd4973039d4c648b9c4535154699d4", "Org95", "fcb09822983f4723b0799941e76e9c60", "Org25", "4d36ddb24c9e4cc38572abbd646c1e58"],
  // q164: 97 organizations in SAP-SAM Aggregated BPMN Corpus
  ["97", "organizations", "SAP-SAM Aggregated BPMN Corpus"],
  // q165: fewest models = 1, 71 organizations tied
  ["fewest", "1", "model", "71", "organizations", "minimum"],
  // q166: 2 organizations with restaurant models: Org2 and Org53
  ["2", "organizations", "restaurants", "Org2", "Org53"],
  // q167: 5 organizations with university admissions models
  ["5", "organizations", "university admissions", "Org18", "8", "models", "German", "Org97", "choreo", "Org92", "A2 Section 1 choreo", "Org19", "Choreography", "Org85", "Cancellation choreography"],
  // q168: 2 organizations with car rental models: Org60 and Org35
  ["2", "organizations", "car rentals", "Org60", "Org35"],
  // q169: 4 organizations with online shopping/webshop models
  ["4", "organizations", "online shopping", "webshops", "Org20", "3", "wardrobe shop", "Org52", "online auction house", "Org68", "Org87"],
  // q170: 6 organizations with medical/healthcare models
  ["6", "organizations", "medical", "healthcare", "Org10", "Choreography diagram (fixed)", "Org20", "Wilk_Jane Doe_2", "Org34", "Choreographiediagramm (Kopie)", "Org39", "Org65", "Doctor-patient recipe", "Org68", "12345678"],
  // q171: organization contains 40 models
  ["40", "models", "c41660388a04449a995dccf97d894f46"],
  // q172: 40 models, German and English, smaller portion Spanish
  ["40", "models", "German", "English", "Spanish"],
  // q173: 5 models include parallel execution (Parallel Gateways), listed IDs
  ["5", "models", "parallel execution", "Parallel Gateways", "c41660388a04449a995dccf97d894f46", "2d634d45664f4e9f8e1d18e4d4e83530", "0b4394edaa09437d93cc54c78c0180cb", "1c39124a3f10408e9b45639c1c042949", "5fad1cde52e243bc8797a096bc012bf5", "4e8df28e6d9f4afe970d06522542e830"],
  // q174: 4 distinct models, 9 choreography tasks, invoice processing
  ["4", "models", "9", "choreography tasks", "invoice processing", "Org68", "c41660388a04449a995dccf97d894f46", "12345678", "2d887704e5324e6bb2126cef061e50e9", "2d8ea038966a44ad8eb4d6a1cb0e57e4", "2fbef9fde00947c8acee5262d65f7b84", "2d5f102915a94ee4af2113fc9bb62024"],
  // q175: academic institution, SAP Signavio, teaching BPMN, multilingual
  ["academic institution", "SAP Signavio", "teaching", "BPMN choreography modeling", "multilingual", "German", "English", "Spanish", "e-commerce", "procurement", "logistics", "healthcare", "finance", "advertising"],
  // q176: organization contains 37 models
  ["37", "models", "5e1278d2bfce434b95e80ab3625cdc63"],
  // q177: models written in Serbian (Latin script), Org31
  ["Serbian", "Latin script", "Org31", "5e1278d2bfce434b95e80ab3625cdc63"],
  // q178: 16 models with technical support choreography tasks
  ["16", "models", "choreography tasks", "technical support", "5e1278d2bfce434b95e80ab3625cdc63", "12345678_3", "30.03.2019_Zadatak2", "30.3.2019 16:15", "Dijagram koreografija - Zadatak V6", "Dijagram koreografije", "Koreografija", "Koreografija K/O", "Koreografija zad1", "New Process", "VEŽBE 5 - Korisnički servis", "Vezbe koreografija", "Vežbe 5 koreogafija", "call centar četvrtak 10:00 koreografija", "koreografija", "koreografija na osnovu kol", "koreografija(12.mart)"],
  // q179: 32 models with participant "Operater"
  ["32", "models", "participant", "Operater", "5e1278d2bfce434b95e80ab3625cdc63"],
  // q180: time difference ~2 years, 5 months, 13 days (~896 days)
  ["2 years", "5 months", "13 days", "896 days", "earliest", "latest", "model creation dates"],
  // q181: organization contains 25 models
  ["25", "models", "985f88f59e8b4962a0a2c2fec001b6d1"],
  // q182: 'Auktionshaus_Online' belongs to Org52
  ["Auktionshaus_Online", "Org52", "985f88f59e8b4962a0a2c2fec001b6d1"],
  // q183: Org52 has 25 models, only org with that count
  ["25", "models", "Org52", "985f88f59e8b4962a0a2c2fec001b6d1", "only organization"],
  // q184: 5 models with purchasing goods tasks
  ["5", "models", "purchasing goods", "choreography tasks", "985f88f59e8b4962a0a2c2fec001b6d1", "Einkauf (BPMN Choreographiediagramm)", "Choreographie Einkauf im Fachhandel", "7 Choreo", "7) Choreographie und Konversation", "Auktionshaus_Online"],
  // q185: 1 model about restaurant/food ordering
  ["1", "model", "restaurant", "food ordering", "985f88f59e8b4962a0a2c2fec001b6d1", "7) Choreographie und Konversation"],
  // q186: organization contains 15 models
  ["15", "models", "2dafb1f0acb24b27ae8f0dc47d14fcaa"],
  // q187: German primarily, one English "choreography"
  ["German", "Org18", "2dafb1f0acb24b27ae8f0dc47d14fcaa", "English", "choreography"],
  // q188: 1 model related to university application
  ["1", "model", "university application", "Choreographiedagramm Hochschulbewerbung", "2dafb1f0acb24b27ae8f0dc47d14fcaa", "https://www.teamingai-project.eu/kg/model/sid_e0cff846_e631_4657_9d55_ab4c98968cd7"],
  // q189: 6 models with "Bewerber" (Applicant) participant
  ["6", "models", "Bewerber", "Applicant", "participant", "Hochschulbewerbung", "2dafb1f0acb24b27ae8f0dc47d14fcaa", "A. 2", "BlattG_Aufgabe2", "Choreographiedagramm Hochschulbewerbung", "choreography", "Übungsblatt G - Aufgabe 2 two way", "Übungsblatt G/2"],
  // q190: No models include parallel execution
  ["no", "models", "parallel execution", "2dafb1f0acb24b27ae8f0dc47d14fcaa"],
  // q191: organization contains 13 models
  ["13", "models", "67e70970f0404a7e87122700ad26d87b"],
  // q192: models in Org35 are English
  ["English", "Org35", "67e70970f0404a7e87122700ad26d87b"],
  // q193: 1 model about bike rental or insurance
  ["1", "model", "bike rental", "insurance", "Bike rental spezzato", "67e70970f0404a7e87122700ad26d87b"],
  // q194: No sole unified profile for Org35, 13 models, diverse themes
  ["no", "sole", "unified profile", "Org35", "67e70970f0404a7e87122700ad26d87b", "13", "models", "diverse", "BPMN choreography patterns"],
  // q195: "Bike rental spezzato" - Customer appears in 14 tasks (most)
  ["Bike rental spezzato", "Customer", "participant", "most tasks", "14", "67e70970f0404a7e87122700ad26d87b"],
];
