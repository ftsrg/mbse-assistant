import unittest


import os
import subprocess
import contextlib
import pathlib
import logging


import rdflib


logging.basicConfig(level=logging.DEBUG)



def create_and_return_path():
    return os.path.dirname(os.path.realpath(__file__))



def save_to_file(file_name, string):
    path_to_file = f'{create_and_return_path()}/{file_name}.bpmn'
    logging.debug(f'Saving to {path_to_file}')
    with open(path_to_file, mode='w', encoding='UTF-8') as f:
        f.write(string)


def delete_file(file_name):
    path_to_file = f'{create_and_return_path()}/{file_name}'
    logging.debug(f'Deleting file {path_to_file}')
    os.remove(path_to_file)


def execute(file_name, ontology):
    subprocess.run([
            'python', './bpmn_to_kg/__init__.py',
            '--ontology', f'{ontology}',
            '--bpmn-input', f'{create_and_return_path()}/{file_name}.bpmn',
            '--kg-output', f'{create_and_return_path()}/{file_name}.ttl'])





class _tests_context_manager(contextlib.AbstractContextManager):
    def __init__(self, file_name, bpmn, ontology):
        self.file_name = file_name
        self.bpmn = bpmn
        self.ontology = ontology

    def __enter__(self):
        save_to_file(file_name=self.file_name, string=self.bpmn)

        execute(file_name=self.file_name, ontology=self.ontology)

        result_turtle = rdflib.Graph().parse(f'{create_and_return_path()}/{self.file_name}.ttl', format='turtle')

        return result_turtle

    def __exit__(self, exception_type, exception_value, traceback):
        delete_file(file_name=f'{self.file_name}.bpmn')
        delete_file(file_name=f'{self.file_name}.ttl')


class bbo_test(_tests_context_manager):

    def __init__(self, file_name, bpmn):
        super(bbo_test, self).__init__(file_name=file_name, bpmn=bpmn, ontology='bbo')


class bbo_extension_test(_tests_context_manager):

    def __init__(self, file_name, bpmn):
        super(bbo_extension_test, self).__init__(file_name=file_name, bpmn=bpmn, ontology='bboExtension')






class TestBPMNMappingToBBO(unittest.TestCase):
    '''
        Test for the mapping from 
            Business Process Model and Notation (BPMN)
        to
            Business Process Model and Notation Based Ontology (BBO)
    '''
    def setUp(self):
        self.dir = pathlib.Path(f'{os.path.dirname(os.path.realpath(__file__))}')


    def set_up(self, file_name, string):
        save_to_file(file_name=file_name, string=string)


    def tear_down(self, file_name):
        delete_file(file_name=f'{file_name}.bpmn')
        delete_file(file_name=f'{file_name}.ttl')



    def test_process(self):
        bpmn =  '<?xml version="1.0" encoding="UTF-8"?>'\
                '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="Definitions_0fr9mxs" targetNamespace="http://bpmn.io/schema/bpmn" exporter="Camunda Modeler" exporterVersion="4.9.0">'\
                    '<bpmn:process id="teaming-engine-process-without-messages" isExecutable="true">'\
                    '</bpmn:process>'\
                '</bpmn:definitions>'

        expected_turtle = rdflib.Graph().parse(data='''
                @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
                @prefix teamingAI: <https://www.teamingai-project.eu/> .
                @prefix rami: <https://w3id.org/i40/rami#> .

                <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>
                    rdfs:comment "representation of a business process using business process model and notation business ontology";
                    rdfs:subClassOf <https://www.irit.fr/recherches/MELODI/ontologies/BBO#Process>;
                    teamingAI:belongsToRAMILayer rami:Business;
                    teamingAI:belongsToView teamingAI:BusinessProcessManagementView .
        ''', format='turtle')


        with bbo_test(file_name='process', bpmn=bpmn) as result_turtle:
            self.assertEqual(set(result_turtle), set(expected_turtle))


    def test_task(self):
        bpmn = '<?xml version="1.0" encoding="UTF-8"?>'\
                '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="Definitions_0fr9mxs" targetNamespace="http://bpmn.io/schema/bpmn" exporter="Camunda Modeler" exporterVersion="4.9.0">'\
                        '<bpmn:process id="teaming-engine-process-without-messages" isExecutable="true">'\
                                '<bpmn:task id="Activity_0c4o6pt" name="Activity A" />'\
                        '</bpmn:process>'\
                '</bpmn:definitions>'
        

        expected_turtle = rdflib.Graph().parse(data='''
            @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
            @prefix teamingAI: <https://www.teamingai-project.eu/> .
            @prefix rami: <https://w3id.org/i40/rami#> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/Activity_0c4o6pt>
                rdfs:comment    "A Task is an atomic Activity within a Process flow. A Task is used when the work in the Process cannot be broken down to a finer level of detail. Generally, an end-user and/or applications are used to perform the Task when it is executed."@en;
                rdfs:label      "task"@en;
                teamingAI:belongsToProcess <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>;
                <https://www.irit.fr/recherches/MELODI/ontologies/BBO#name> "Activity A" ;
                rdfs:subClassOf <https://www.irit.fr/recherches/MELODI/ontologies/BBO#Task> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>
                rdfs:comment    "representation of a business process using business process model and notation business ontology";
                rdfs:subClassOf <https://www.irit.fr/recherches/MELODI/ontologies/BBO#Process> ;
                teamingAI:belongsToRAMILayer rami:Business;
                teamingAI:belongsToView teamingAI:BusinessProcessManagementView .
        ''', format='turtle')


        with bbo_test(file_name='task', bpmn=bpmn) as result_turtle:
            self.assertEqual(set(result_turtle), set(expected_turtle))

    
    def test_user_task(self):
        bpmn = '<?xml version="1.0" encoding="UTF-8"?>'\
               '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="Definitions_0fr9mxs" targetNamespace="http://bpmn.io/schema/bpmn" exporter="Camunda Modeler" exporterVersion="4.9.0">'\
                    '<bpmn:process id="teaming-engine-process-without-messages" isExecutable="true">'\
                            '<bpmn:userTask id="Activity_0c4o6pt" name="Activity A" />'\
                    '</bpmn:process>'\
                '</bpmn:definitions>'


        expected_turtle = rdflib.Graph().parse(data='''
            @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
            @prefix teamingAI: <https://www.teamingai-project.eu/> .
            @prefix rami: <https://w3id.org/i40/rami#> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/Activity_0c4o6pt>
                rdfs:comment        "A User Task is a typical “workflow” Task where a human performer performs the Task with the assistance of a software application and is scheduled through a task list manager of some sort."@en;
                rdfs:label          "user task"@en;
                teamingAI:belongsToProcess <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>;
                <https://www.irit.fr/recherches/MELODI/ontologies/BBO#name> "Activity A" ;
                rdfs:subClassOf     <https://www.irit.fr/recherches/MELODI/ontologies/BBO#UserTask> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>
                rdfs:comment        "representation of a business process using business process model and notation business ontology";
                rdfs:subClassOf     <https://www.irit.fr/recherches/MELODI/ontologies/BBO#Process> ;
                teamingAI:belongsToRAMILayer rami:Business;
                teamingAI:belongsToView teamingAI:BusinessProcessManagementView .
        ''', format='turtle')


        with bbo_test(file_name='user_task', bpmn=bpmn) as result_turtle:
            self.assertEqual(set(result_turtle), set(expected_turtle))


    def test_manual_task(self):
        bpmn = '<?xml version="1.0" encoding="UTF-8"?>'\
               '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="Definitions_0fr9mxs" targetNamespace="http://bpmn.io/schema/bpmn" exporter="Camunda Modeler" exporterVersion="4.9.0">'\
                    '<bpmn:process id="teaming-engine-process-without-messages" isExecutable="true">'\
                            '<bpmn:manualTask id="Activity_1xiaipc" />'\
                    '</bpmn:process>'\
               '</bpmn:definitions>'


        expected_turtle = rdflib.Graph().parse(data='''
            @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
            @prefix teamingAI: <https://www.teamingai-project.eu/> .
            @prefix rami: <https://w3id.org/i40/rami#> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/Activity_1xiaipc>
                rdfs:comment        "A Manual Task is a Task that is expected to be performed without the aid of any business process execution engine or any application. An example of this could be a telephone technician installing a telephone at a customer location."@en;
                rdfs:label          "manual task"@en;
                teamingAI:belongsToProcess <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>;
                rdfs:subClassOf     <https://www.irit.fr/recherches/MELODI/ontologies/BBO#ManualTask> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>
                rdfs:comment        "representation of a business process using business process model and notation business ontology";
                rdfs:subClassOf     <https://www.irit.fr/recherches/MELODI/ontologies/BBO#Process> ;
                teamingAI:belongsToRAMILayer rami:Business;
                teamingAI:belongsToView teamingAI:BusinessProcessManagementView .
        ''', format='turtle')


        with bbo_test(file_name='manual_task', bpmn=bpmn) as result_turtle:
            self.assertEqual(set(result_turtle), set(expected_turtle))


    def test_service_task(self):
        bpmn = '<?xml version="1.0" encoding="UTF-8"?>'\
               '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="Definitions_0fr9mxs" targetNamespace="http://bpmn.io/schema/bpmn" exporter="Camunda Modeler" exporterVersion="4.9.0">'\
                    '<bpmn:process id="teaming-engine-process-without-messages" isExecutable="true">'\
                            '<bpmn:serviceTask id="Activity_0vdqb2o" name="Abstract" camunda:type="external" camunda:topic="abstractActivity">'\
                            '</bpmn:serviceTask>'\
                    '</bpmn:process>'\
               '</bpmn:definitions>'

        expected_turtle = rdflib.Graph().parse(data='''
            @prefix bbo: <https://www.irit.fr/recherches/MELODI/ontologies/BBO#> .
            @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
            @prefix teamingAI: <https://www.teamingai-project.eu/> .
            @prefix rami: <https://w3id.org/i40/rami#> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/Activity_0vdqb2o>
                rdfs:comment    "A Service Task is a Task that uses some sort of service, which could be a Web service or an automated application."@en;
                rdfs:label      "service task"@en;
                bbo:name        "Abstract";
                teamingAI:belongsToProcess <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>;
                rdfs:subClassOf <https://www.irit.fr/recherches/MELODI/ontologies/BBO#ServiceTask>.

            <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>
            rdfs:comment        "representation of a business process using business process model and notation business ontology";
            rdfs:subClassOf     <https://www.irit.fr/recherches/MELODI/ontologies/BBO#Process> ;
            teamingAI:belongsToRAMILayer rami:Business;
            teamingAI:belongsToView teamingAI:BusinessProcessManagementView .
        ''', format='turtle')


        with bbo_test(file_name='service_task', bpmn=bpmn) as result_turtle:
            self.assertEqual(set(result_turtle), set(expected_turtle))


    def test_start_event(self):
        bpmn = '<?xml version="1.0" encoding="UTF-8"?>'\
               '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="Definitions_0fr9mxs" targetNamespace="http://bpmn.io/schema/bpmn" exporter="Camunda Modeler" exporterVersion="4.9.0">'\
                    '<bpmn:process id="teaming-engine-process-without-messages" isExecutable="true">'\
                            '<bpmn:startEvent id="StartEvent_1">'\
                                '<bpmn:outgoing>SequenceFlow_1fp17al</bpmn:outgoing>'\
                            '</bpmn:startEvent>'\
                            '<bpmn:serviceTask id="Activity_0vdqb2o" name="Abstract" camunda:type="external" camunda:topic="abstractActivity">'\
                                '<bpmn:incoming>SequenceFlow_1fp17al</bpmn:incoming>'\
                            '</bpmn:serviceTask>'\
                    '</bpmn:process>'\
               '</bpmn:definitions>'

        expected_turtle = rdflib.Graph().parse(data='''
            @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
            @prefix tai: <https://www.teamingai-project.eu/> .
            @prefix teamingAI: <https://www.teamingai-project.eu/> .
            @prefix rami: <https://w3id.org/i40/rami#> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/Activity_0vdqb2o>
                rdfs:comment    "A Service Task is a Task that uses some sort of service, which could be a Web service or an automated application."@en;
                rdfs:label      "service task"@en;
                <https://www.irit.fr/recherches/MELODI/ontologies/BBO#name> "Abstract" ;
                teamingAI:belongsToProcess <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>;
                rdfs:subClassOf <https://www.irit.fr/recherches/MELODI/ontologies/BBO#ServiceTask> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/StartEvent_1>
            rdfs:comment    "The Start Event indicates where a particular Process will start. In terms of Sequence Flows, the Start Event starts the flow of the Process, and thus, will not have any incoming Sequence Flows—no Sequence Flow can connect to a Start Event."@en;
            rdfs:label      "start event"@en;
            rdfs:subClassOf <https://www.irit.fr/recherches/MELODI/ontologies/BBO#StartEvent>;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#has_targetRef> <https://www.teamingai-project.eu/kg/process/qualityInspection/SequenceFlow_1fp17al>;
            tai:belongsToProcess <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>
            rdfs:comment        "representation of a business process using business process model and notation business ontology";
            rdfs:subClassOf     <https://www.irit.fr/recherches/MELODI/ontologies/BBO#Process>;
            teamingAI:belongsToRAMILayer rami:Business;
            teamingAI:belongsToView teamingAI:BusinessProcessManagementView .
        ''', format='turtle')


        with bbo_test(file_name='start_event', bpmn=bpmn) as result_turtle:
            self.assertEqual(set(result_turtle), set(expected_turtle))


    def test_end_event(self):
        bpmn = '<?xml version="1.0" encoding="UTF-8"?>'\
               '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="Definitions_0fr9mxs" targetNamespace="http://bpmn.io/schema/bpmn" exporter="Camunda Modeler" exporterVersion="4.9.0">'\
                    '<bpmn:process id="teaming-engine-process-without-messages" isExecutable="true">'\
                            '<bpmn:endEvent id="EndEvent_0x6ir2l">'\
                                '<bpmn:incoming>Flow_0ii15xx</bpmn:incoming>'\
                            '</bpmn:endEvent>'\
                            '<bpmn:sequenceFlow id="Flow_0ii15xx" sourceRef="Activity_01uj6jy" targetRef="EndEvent_0x6ir2l" />'\
                    '</bpmn:process>'\
               '</bpmn:definitions>'


        expected_turtle = rdflib.Graph().parse(data='''
            @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
            @prefix teamingAI: <https://www.teamingai-project.eu/> .
            @prefix rami: <https://w3id.org/i40/rami#> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/EndEvent_0x6ir2l>
            rdfs:comment        "The End Event indicates where a Process will end. In terms of Sequence Flows, the End Event ends the flow of the Process, and thus, will not have any outgoing Sequence Flows—no Sequence Flow can connect from an End Event."@en;
            rdfs:label          "end event"@en;
            teamingAI:belongsToProcess <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>;
            rdfs:subClassOf <https://www.irit.fr/recherches/MELODI/ontologies/BBO#EndEvent> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/Flow_0ii15xx>
            rdfs:comment        "A Sequence Flow is used to show the order of Flow Elements in a Process or a Choreography. Each Sequence Flow has only one source and only one target. The source and target MUST be from the set of the following Flow Elements: Events (Start, Intermediate, and End), Activities (Task and Sub-Process; for Processes), Choreography Activities (Choreography Task and Sub-Choreography; for Choreographies), and Gateways."@en;
            rdfs:subClassOf     <https://www.irit.fr/recherches/MELODI/ontologies/BBO#sequenceFlow>;
            teamingAI:belongsToProcess <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#has_sourceRef> <https://www.teamingai-project.eu/kg/process/qualityInspection/Activity_01uj6jy>;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#has_targetRef> <https://www.teamingai-project.eu/kg/process/qualityInspection/EndEvent_0x6ir2l> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>
            rdfs:comment        "representation of a business process using business process model and notation business ontology";
            rdfs:subClassOf     <https://www.irit.fr/recherches/MELODI/ontologies/BBO#Process>;
            teamingAI:belongsToRAMILayer rami:Business;
            teamingAI:belongsToView teamingAI:BusinessProcessManagementView .
        ''', format='turtle')


        with bbo_test(file_name='end_event', bpmn=bpmn) as result_turtle:
            self.assertEqual(set(result_turtle), set(expected_turtle))


    def test_sequence_flow(self):
        bpmn = '<?xml version="1.0" encoding="UTF-8"?>'\
               '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="Definitions_0fr9mxs" targetNamespace="http://bpmn.io/schema/bpmn" exporter="Camunda Modeler" exporterVersion="4.9.0">'\
                    '<bpmn:process id="teaming-engine-process-without-messages" isExecutable="true">'\
                            '<bpmn:sequenceFlow id="Flow_03zdn6r" sourceRef="Activity_1iorly5" targetRef="Activity_01uj6jy" />'\
                            '<bpmn:serviceTask id="Activity_1iorly5" name="Concrete" camunda:type="external" camunda:topic="concreteActivity">'\
                                '<bpmn:outgoing>Flow_03zdn6r</bpmn:outgoing>'\
                            '</bpmn:serviceTask>'\
                            '<bpmn:serviceTask id="Activity_01uj6jy" name="Direct REST Call">'\
                                '<bpmn:incoming>Flow_03zdn6r</bpmn:incoming>'\
                            '</bpmn:serviceTask>'\
                    '</bpmn:process>'\
               '</bpmn:definitions>'


        expected_turtle = rdflib.Graph().parse(data='''
            @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
            @prefix teamingAI: <https://www.teamingai-project.eu/> .
            @prefix rami: <https://w3id.org/i40/rami#> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/Activity_01uj6jy>
            rdfs:comment    "A Service Task is a Task that uses some sort of service, which could be a Web service or an automated application."@en;
            rdfs:label      "service task"@en;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#name>  "Direct REST Call" ;
            teamingAI:belongsToProcess <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>;
            rdfs:subClassOf <https://www.irit.fr/recherches/MELODI/ontologies/BBO#ServiceTask> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/Activity_1iorly5>
            rdfs:comment    "A Service Task is a Task that uses some sort of service, which could be a Web service or an automated application."@en;
            rdfs:label      "service task"@en;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#name>  "Concrete" ;
            teamingAI:belongsToProcess <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>;
            rdfs:subClassOf <https://www.irit.fr/recherches/MELODI/ontologies/BBO#ServiceTask> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/Flow_03zdn6r>
            rdfs:comment        "A Sequence Flow is used to show the order of Flow Elements in a Process or a Choreography. Each Sequence Flow has only one source and only one target. The source and target MUST be from the set of the following Flow Elements: Events (Start, Intermediate, and End), Activities (Task and Sub-Process; for Processes), Choreography Activities (Choreography Task and Sub-Choreography; for Choreographies), and Gateways."@en;
            rdfs:subClassOf     <https://www.irit.fr/recherches/MELODI/ontologies/BBO#sequenceFlow>;
            teamingAI:belongsToProcess <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#has_sourceRef> <https://www.teamingai-project.eu/kg/process/qualityInspection/Activity_1iorly5>;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#has_targetRef> <https://www.teamingai-project.eu/kg/process/qualityInspection/Activity_01uj6jy> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>
            rdfs:comment        "representation of a business process using business process model and notation business ontology";
            rdfs:subClassOf     <https://www.irit.fr/recherches/MELODI/ontologies/BBO#Process> ;
            teamingAI:belongsToRAMILayer rami:Business;
            teamingAI:belongsToView teamingAI:BusinessProcessManagementView .
        ''', format='turtle')


        with bbo_test(file_name='sequence_flow', bpmn=bpmn) as result_turtle:
            self.assertEqual(set(result_turtle), set(expected_turtle))


    def test_xor_gateway(self):
        bpmn = '<?xml version="1.0" encoding="UTF-8"?>'\
               '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="Definitions_0fr9mxs" targetNamespace="http://bpmn.io/schema/bpmn" exporter="Camunda Modeler" exporterVersion="4.9.0">'\
                    '<bpmn:process id="teaming-engine-process-without-messages" isExecutable="true">'\
                            '<bpmn:exclusiveGateway id="Gateway_14mrt4r">'\
                                '<bpmn:outgoing>Flow_0a652ks</bpmn:outgoing>'\
                                '<bpmn:outgoing>Flow_0decygb</bpmn:outgoing>'\
                            '</bpmn:exclusiveGateway>'\
                            '<bpmn:task id="Activity_0c4o6pt" name="Activity A">'\
                                '<bpmn:incoming>Flow_0a652ks</bpmn:incoming>'\
                                '<bpmn:outgoing>Flow_0tw182q</bpmn:outgoing>'\
                            '</bpmn:task>'\
                            '<bpmn:sequenceFlow id="Flow_0a652ks" sourceRef="Gateway_14mrt4r" targetRef="Activity_0c4o6pt" />'\
                            '<bpmn:task id="Activity_0zmla4n" name="Activity B">'\
                                '<bpmn:incoming>Flow_0decygb</bpmn:incoming>'\
                                '<bpmn:outgoing>Flow_1clbg2z</bpmn:outgoing>'\
                            '</bpmn:task>'\
                            '<bpmn:sequenceFlow id="Flow_0decygb" sourceRef="Gateway_14mrt4r" targetRef="Activity_0zmla4n" />'\
                            '<bpmn:exclusiveGateway id="Gateway_1m9ivlg">'\
                                '<bpmn:incoming>Flow_0tw182q</bpmn:incoming>'\
                                '<bpmn:incoming>Flow_1clbg2z</bpmn:incoming>'\
                            '</bpmn:exclusiveGateway>'\
                            '<bpmn:sequenceFlow id="Flow_0tw182q" sourceRef="Activity_0c4o6pt" targetRef="Gateway_1m9ivlg" />'\
                            '<bpmn:sequenceFlow id="Flow_1clbg2z" sourceRef="Activity_0zmla4n" targetRef="Gateway_1m9ivlg" />'\
                    '</bpmn:process>'\
               '</bpmn:definitions>'


        expected_turtle = rdflib.Graph().parse(data='''
            @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
            @prefix teamingAI: <https://www.teamingai-project.eu/> .
            @prefix rami: <https://w3id.org/i40/rami#> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/Activity_0c4o6pt>
            rdfs:comment    "A Task is an atomic Activity within a Process flow. A Task is used when the work in the Process cannot be broken down to a finer level of detail. Generally, an end-user and/or applications are used to perform the Task when it is executed."@en;
            rdfs:label      "task"@en;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#name> "Activity A" ;
            teamingAI:belongsToProcess <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>;
            rdfs:subClassOf <https://www.irit.fr/recherches/MELODI/ontologies/BBO#Task> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/Activity_0zmla4n>
            rdfs:comment    "A Task is an atomic Activity within a Process flow. A Task is used when the work in the Process cannot be broken down to a finer level of detail. Generally, an end-user and/or applications are used to perform the Task when it is executed."@en;
            rdfs:label      "task"@en;
            teamingAI:belongsToProcess <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#name> "Activity B" ;
            rdfs:subClassOf <https://www.irit.fr/recherches/MELODI/ontologies/BBO#Task> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/Flow_0a652ks>
            rdfs:comment    "A Sequence Flow is used to show the order of Flow Elements in a Process or a Choreography. Each Sequence Flow has only one source and only one target. The source and target MUST be from the set of the following Flow Elements: Events (Start, Intermediate, and End), Activities (Task and Sub-Process; for Processes), Choreography Activities (Choreography Task and Sub-Choreography; for Choreographies), and Gateways."@en;
            rdfs:subClassOf <https://www.irit.fr/recherches/MELODI/ontologies/BBO#sequenceFlow>;
            teamingAI:belongsToProcess <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#has_sourceRef> <https://www.teamingai-project.eu/kg/process/qualityInspection/Gateway_14mrt4r>;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#has_targetRef> <https://www.teamingai-project.eu/kg/process/qualityInspection/Activity_0c4o6pt> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/Flow_0decygb>
            rdfs:comment    "A Sequence Flow is used to show the order of Flow Elements in a Process or a Choreography. Each Sequence Flow has only one source and only one target. The source and target MUST be from the set of the following Flow Elements: Events (Start, Intermediate, and End), Activities (Task and Sub-Process; for Processes), Choreography Activities (Choreography Task and Sub-Choreography; for Choreographies), and Gateways."@en;
            rdfs:subClassOf <https://www.irit.fr/recherches/MELODI/ontologies/BBO#sequenceFlow>;
            teamingAI:belongsToProcess <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#has_sourceRef> <https://www.teamingai-project.eu/kg/process/qualityInspection/Gateway_14mrt4r>;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#has_targetRef> <https://www.teamingai-project.eu/kg/process/qualityInspection/Activity_0zmla4n> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/Flow_0tw182q>
            rdfs:comment    "A Sequence Flow is used to show the order of Flow Elements in a Process or a Choreography. Each Sequence Flow has only one source and only one target. The source and target MUST be from the set of the following Flow Elements: Events (Start, Intermediate, and End), Activities (Task and Sub-Process; for Processes), Choreography Activities (Choreography Task and Sub-Choreography; for Choreographies), and Gateways."@en;
            rdfs:subClassOf <https://www.irit.fr/recherches/MELODI/ontologies/BBO#sequenceFlow>;
            teamingAI:belongsToProcess <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#has_sourceRef> <https://www.teamingai-project.eu/kg/process/qualityInspection/Activity_0c4o6pt>;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#has_targetRef> <https://www.teamingai-project.eu/kg/process/qualityInspection/Gateway_1m9ivlg> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/Flow_1clbg2z>
            rdfs:comment    "A Sequence Flow is used to show the order of Flow Elements in a Process or a Choreography. Each Sequence Flow has only one source and only one target. The source and target MUST be from the set of the following Flow Elements: Events (Start, Intermediate, and End), Activities (Task and Sub-Process; for Processes), Choreography Activities (Choreography Task and Sub-Choreography; for Choreographies), and Gateways."@en;
            rdfs:subClassOf <https://www.irit.fr/recherches/MELODI/ontologies/BBO#sequenceFlow>;
            teamingAI:belongsToProcess <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#has_sourceRef> <https://www.teamingai-project.eu/kg/process/qualityInspection/Activity_0zmla4n>;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#has_targetRef> <https://www.teamingai-project.eu/kg/process/qualityInspection/Gateway_1m9ivlg> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/Gateway_14mrt4r>
            rdfs:comment    "A diverging Exclusive Gateway (Decision) is used to create alternative paths within a Process flow. This is basically the “diversion point in the road” for a Process. For a given instance of the Process, only one of the paths can be taken."@en;
            rdfs:label      "exclusive or gateway"@en;
            teamingAI:belongsToProcess <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#has_targetRef> <https://www.teamingai-project.eu/kg/process/qualityInspection/Flow_0a652ks>;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#has_targetRef> <https://www.teamingai-project.eu/kg/process/qualityInspection/Flow_0decygb>;
            rdfs:subClassOf <https://www.irit.fr/recherches/MELODI/ontologies/BBO#ExclusiveGateway> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/Gateway_1m9ivlg>
            rdfs:comment    "A diverging Exclusive Gateway (Decision) is used to create alternative paths within a Process flow. This is basically the “diversion point in the road” for a Process. For a given instance of the Process, only one of the paths can be taken."@en;
            rdfs:label      "exclusive or gateway"@en;
            teamingAI:belongsToProcess <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#has_sourceRef> <https://www.teamingai-project.eu/kg/process/qualityInspection/Flow_0tw182q>;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#has_sourceRef> <https://www.teamingai-project.eu/kg/process/qualityInspection/Flow_1clbg2z>;
            rdfs:subClassOf <https://www.irit.fr/recherches/MELODI/ontologies/BBO#ExclusiveGateway> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>
            rdfs:comment "representation of a business process using business process model and notation business ontology";
            rdfs:subClassOf <https://www.irit.fr/recherches/MELODI/ontologies/BBO#Process> ;
            teamingAI:belongsToRAMILayer rami:Business;
            teamingAI:belongsToView teamingAI:BusinessProcessManagementView .
        ''', format='turtle')


        with bbo_test(file_name='xor_gateway', bpmn=bpmn) as result_turtle:
            self.assertEqual(set(result_turtle), set(expected_turtle))


    def test_parallel_gateway(self):
        bpmn = '<?xml version="1.0" encoding="UTF-8"?>'\
               '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="Definitions_0fr9mxs" targetNamespace="http://bpmn.io/schema/bpmn" exporter="Camunda Modeler" exporterVersion="4.9.0">'\
                    '<bpmn:process id="teaming-engine-process-without-messages" isExecutable="true">'\
                            '<bpmn:task id="Activity_0c4o6pt" name="Activity A">'\
                                '<bpmn:incoming>Flow_0a652ks</bpmn:incoming>'\
                                '<bpmn:outgoing>Flow_0tw182q</bpmn:outgoing>'\
                            '</bpmn:task>'\
                            '<bpmn:sequenceFlow id="Flow_0a652ks" sourceRef="Gateway_14mrt4r" targetRef="Activity_0c4o6pt" />'\
                            '<bpmn:task id="Activity_0zmla4n" name="Activity B">'\
                                '<bpmn:incoming>Flow_0decygb</bpmn:incoming>'\
                                '<bpmn:outgoing>Flow_1clbg2z</bpmn:outgoing>'\
                            '</bpmn:task>'\
                            '<bpmn:sequenceFlow id="Flow_0decygb" sourceRef="Gateway_14mrt4r" targetRef="Activity_0zmla4n" />'\
                            '<bpmn:sequenceFlow id="Flow_0tw182q" sourceRef="Activity_0c4o6pt" targetRef="Gateway_1m9ivlg" />'\
                            '<bpmn:sequenceFlow id="Flow_1clbg2z" sourceRef="Activity_0zmla4n" targetRef="Gateway_1m9ivlg" />'\
                            '<bpmn:parallelGateway id="Gateway_14mrt4r">'\
                                '<bpmn:outgoing>Flow_0a652ks</bpmn:outgoing>'\
                                '<bpmn:outgoing>Flow_0decygb</bpmn:outgoing>'\
                            '</bpmn:parallelGateway>'\
                            '<bpmn:parallelGateway id="Gateway_1m9ivlg">'\
                                '<bpmn:incoming>Flow_0tw182q</bpmn:incoming>'\
                                '<bpmn:incoming>Flow_1clbg2z</bpmn:incoming>'\
                            '</bpmn:parallelGateway>'\
                    '</bpmn:process>'\
               '</bpmn:definitions>'


        expected_turtle = rdflib.Graph().parse(data='''
            @prefix bbo: <https://www.irit.fr/recherches/MELODI/ontologies/BBO#> .
            @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
            @prefix teamingAI: <https://www.teamingai-project.eu/> .
            @prefix rami: <https://w3id.org/i40/rami#> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/Activity_0c4o6pt>
            rdfs:comment    "A Task is an atomic Activity within a Process flow. A Task is used when the work in the Process cannot be broken down to a finer level of detail. Generally, an end-user and/or applications are used to perform the Task when it is executed."@en;
            rdfs:label      "task"@en;
            teamingAI:belongsToProcess <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>;
            bbo:name "Activity A";
            rdfs:subClassOf <https://www.irit.fr/recherches/MELODI/ontologies/BBO#Task> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/Activity_0zmla4n>
            rdfs:comment    "A Task is an atomic Activity within a Process flow. A Task is used when the work in the Process cannot be broken down to a finer level of detail. Generally, an end-user and/or applications are used to perform the Task when it is executed."@en;
            rdfs:label      "task"@en;
            teamingAI:belongsToProcess <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>;
            bbo:name "Activity B";
            rdfs:subClassOf <https://www.irit.fr/recherches/MELODI/ontologies/BBO#Task> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/Flow_0a652ks>
            rdfs:comment    "A Sequence Flow is used to show the order of Flow Elements in a Process or a Choreography. Each Sequence Flow has only one source and only one target. The source and target MUST be from the set of the following Flow Elements: Events (Start, Intermediate, and End), Activities (Task and Sub-Process; for Processes), Choreography Activities (Choreography Task and Sub-Choreography; for Choreographies), and Gateways."@en;
            rdfs:subClassOf <https://www.irit.fr/recherches/MELODI/ontologies/BBO#sequenceFlow>;
            teamingAI:belongsToProcess <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#has_sourceRef> <https://www.teamingai-project.eu/kg/process/qualityInspection/Gateway_14mrt4r>;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#has_targetRef> <https://www.teamingai-project.eu/kg/process/qualityInspection/Activity_0c4o6pt> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/Flow_0decygb>
            rdfs:comment    "A Sequence Flow is used to show the order of Flow Elements in a Process or a Choreography. Each Sequence Flow has only one source and only one target. The source and target MUST be from the set of the following Flow Elements: Events (Start, Intermediate, and End), Activities (Task and Sub-Process; for Processes), Choreography Activities (Choreography Task and Sub-Choreography; for Choreographies), and Gateways."@en;
            rdfs:subClassOf <https://www.irit.fr/recherches/MELODI/ontologies/BBO#sequenceFlow>;
            teamingAI:belongsToProcess <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#has_sourceRef> <https://www.teamingai-project.eu/kg/process/qualityInspection/Gateway_14mrt4r>;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#has_targetRef> <https://www.teamingai-project.eu/kg/process/qualityInspection/Activity_0zmla4n> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/Flow_0tw182q>
            rdfs:comment    "A Sequence Flow is used to show the order of Flow Elements in a Process or a Choreography. Each Sequence Flow has only one source and only one target. The source and target MUST be from the set of the following Flow Elements: Events (Start, Intermediate, and End), Activities (Task and Sub-Process; for Processes), Choreography Activities (Choreography Task and Sub-Choreography; for Choreographies), and Gateways."@en;
            rdfs:subClassOf <https://www.irit.fr/recherches/MELODI/ontologies/BBO#sequenceFlow>;
            teamingAI:belongsToProcess <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#has_sourceRef> <https://www.teamingai-project.eu/kg/process/qualityInspection/Activity_0c4o6pt>;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#has_targetRef> <https://www.teamingai-project.eu/kg/process/qualityInspection/Gateway_1m9ivlg> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/Flow_1clbg2z>
            rdfs:comment    "A Sequence Flow is used to show the order of Flow Elements in a Process or a Choreography. Each Sequence Flow has only one source and only one target. The source and target MUST be from the set of the following Flow Elements: Events (Start, Intermediate, and End), Activities (Task and Sub-Process; for Processes), Choreography Activities (Choreography Task and Sub-Choreography; for Choreographies), and Gateways."@en;
            rdfs:subClassOf <https://www.irit.fr/recherches/MELODI/ontologies/BBO#sequenceFlow>;
            teamingAI:belongsToProcess <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#has_sourceRef> <https://www.teamingai-project.eu/kg/process/qualityInspection/Activity_0zmla4n>;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#has_targetRef> <https://www.teamingai-project.eu/kg/process/qualityInspection/Gateway_1m9ivlg> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/Gateway_14mrt4r>
            rdfs:comment    "A Parallel Gateway is used to synchronize (combine) parallel flows and to create parallel flows. A Parallel Gateway creates parallel paths without checking any conditions; each outgoing Sequence Flow receives a token upon execution of this Gateway. For incoming flows, the Parallel Gateway will wait for all incoming flows before triggering the flow through its outgoing Sequence Flows."@en;
            rdfs:label      "parallel gateway"@en;
            teamingAI:belongsToProcess <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#has_targetRef> <https://www.teamingai-project.eu/kg/process/qualityInspection/Flow_0decygb>;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#has_targetRef> <https://www.teamingai-project.eu/kg/process/qualityInspection/Flow_0a652ks>;
            rdfs:subClassOf <https://www.irit.fr/recherches/MELODI/ontologies/BBO#ParallelGateway> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/Gateway_1m9ivlg>
            rdfs:comment    "A Parallel Gateway is used to synchronize (combine) parallel flows and to create parallel flows. A Parallel Gateway creates parallel paths without checking any conditions; each outgoing Sequence Flow receives a token upon execution of this Gateway. For incoming flows, the Parallel Gateway will wait for all incoming flows before triggering the flow through its outgoing Sequence Flows."@en;
            rdfs:label      "parallel gateway"@en;
            teamingAI:belongsToProcess <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#has_sourceRef> <https://www.teamingai-project.eu/kg/process/qualityInspection/Flow_0tw182q>;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#has_sourceRef> <https://www.teamingai-project.eu/kg/process/qualityInspection/Flow_1clbg2z>;
            rdfs:subClassOf <https://www.irit.fr/recherches/MELODI/ontologies/BBO#ParallelGateway> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>
            rdfs:comment "representation of a business process using business process model and notation business ontology";
            rdfs:subClassOf <https://www.irit.fr/recherches/MELODI/ontologies/BBO#Process> ;
            teamingAI:belongsToRAMILayer rami:Business;
            teamingAI:belongsToView teamingAI:BusinessProcessManagementView .
        ''', format='turtle')


        with bbo_test(file_name='parallel_gateway', bpmn=bpmn) as result_turtle:
            self.assertEqual(set(result_turtle), set(expected_turtle))



class TestBPMNMappingToBBOExtension(unittest.TestCase) :

    def test_lane(self):
        bpmn = '<?xml version="1.0" encoding="UTF-8"?>'\
               '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="Definitions_0fr9mxs" targetNamespace="http://bpmn.io/schema/bpmn" exporter="Camunda Modeler" exporterVersion="4.9.0">'\
                    '<bpmn:process id="teaming-engine-process-without-messages" isExecutable="false">'\
                            '<bpmn:laneSet id="LaneSet_1omsq7m">'\
                                '<bpmn:lane id="Lane_1xl7byu" name="Lane B" />'\
                                '<bpmn:lane id="Lane_1z11jeh" name="Lane A" />'\
                            '</bpmn:laneSet>'\
                    '</bpmn:process>'\
               '</bpmn:definitions>'


        expected_turtle = rdflib.Graph().parse(data='''
            @prefix bboExtension: <https://www.irit.fr/recherches/MELODI/ontologies/BBO#> .
            @prefix rami: <https://w3id.org/i40/rami#> .
            @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
            @prefix teamingAI: <https://www.teamingai-project.eu/> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/LaneSet_1omsq7m> rdfs:comment
                "The Lane Set element defines the container for one or more Lanes. A Process can contain one or more Lane Sets."@en;
            rdfs:label "lane set"@en;
            rdfs:subClassOf bboExtension:LaneSet .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/Lane_1xl7byu> rdfs:comment
                "A Lane is a sub-partition within a Process (often within a Pool) and will extend the entire length of the Process level, either vertically or horizontally. When a Lane is defined it is contained within a LaneSet, which is contained within a Process."@en;
            rdfs:label "lane"@en;
            rdfs:subClassOf bboExtension:Lane;
            bboExtension:name "Lane B" .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/Lane_1z11jeh> rdfs:comment
                "A Lane is a sub-partition within a Process (often within a Pool) and will extend the entire length of the Process level, either vertically or horizontally. When a Lane is defined it is contained within a LaneSet, which is contained within a Process."@en;
            rdfs:label "lane"@en;
            rdfs:subClassOf bboExtension:Lane;
            bboExtension:name "Lane A" .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>
            rdfs:comment "representation of a business process using business process model and notation business ontology";
            rdfs:subClassOf bboExtension:Process;
            teamingAI:belongsToRAMILayer rami:Business;
            teamingAI:belongsToView teamingAI:BusinessProcessManagementView .
        ''', format='turtle')


        with bbo_extension_test(file_name='lane', bpmn=bpmn) as result_turtle:

            assert len(result_turtle) != 0

            self.assertEqual(len(result_turtle - expected_turtle) == 0,
                            len(expected_turtle - result_turtle) == 0)


            select_lane = '''
                SELECT ?s 
                WHERE { 
                    ?s rdfs:label "lane"@en . 
                }
            '''

            self.assertEqual(len(result_turtle.query(select_lane)), 2)


    def test_pool(self):
        bpmn = '<?xml version="1.0" encoding="UTF-8"?>'\
               '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="Definitions_0fr9mxs" targetNamespace="http://bpmn.io/schema/bpmn" exporter="Camunda Modeler" exporterVersion="4.9.0">'\
                    '<bpmn:process id="teaming-engine-process-without-messages" isExecutable="true">'\
                            '<bpmn:collaboration id="Collaboration_1vr656t">'\
                                '<bpmn:participant id="Participant_0p7yb8c" name="A Pool" processRef="teaming-engine-process-without-messages" />'\
                            '</bpmn:collaboration>'\
                    '</bpmn:process>'\
               '</bpmn:definitions>'


        expected_turtle = rdflib.Graph().parse(data='''
            @prefix bboExtension: <https://www.irit.fr/recherches/MELODI/ontologies/BBO#> .
            @prefix rami: <https://w3id.org/i40/rami#> .
            @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
            @prefix teamingAI: <https://www.teamingai-project.eu/> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/Collaboration_1vr656t>
            rdfs:comment        "A Pool is the graphical representation of a Participant in a Collaboration. A Participant (see page 114) can be a specific PartnerEntity (e.g., a company) or can be a more general PartnerRole (e.g., a buyer, seller, or manufacturer). A Pool MAY or MAY NOT reference a Process. A Pool is NOT REQUIRED to contain a Process, i.e., it can be a “black box.”"@en;
            rdfs:label          "pool"@en;
            rdfs:subClassOf     bboExtension:Collaboration .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>
            rdfs:comment "representation of a business process using business process model and notation business ontology";
            rdfs:subClassOf bboExtension:Process;
            teamingAI:belongsToRAMILayer rami:Business;
            teamingAI:belongsToView teamingAI:BusinessProcessManagementView .
        ''', format='turtle')


        with bbo_extension_test(file_name='pool', bpmn=bpmn) as result_turtle:

            assert len(result_turtle) != 0

            self.assertEqual(len(result_turtle - expected_turtle) == 0,
                            len(expected_turtle - result_turtle) == 0)


            select_pool = '''
                SELECT ?s 
                WHERE { 
                    ?s rdfs:label "pool"@en . 
                }
            '''

            self.assertEqual(len(result_turtle.query(select_pool)), 1)


    def test_text_annotation(self):
        bpmn = '<?xml version="1.0" encoding="UTF-8"?>'\
               '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="Definitions_0fr9mxs" targetNamespace="http://bpmn.io/schema/bpmn" exporter="Camunda Modeler" exporterVersion="4.9.0">'\
                    '<bpmn:process id="teaming-engine-process-without-messages" isExecutable="true">'\
                            '<bpmn:serviceTask id="Activity_1iorly5" name="Concrete" camunda:type="external" camunda:topic="concreteActivity">'\
                            '</bpmn:serviceTask>'\
                            '<bpmn:textAnnotation id="TextAnnotation_08ilqab">'\
                                '<bpmn:text>Concrete Service with Parameter in Activity Model</bpmn:text>'\
                            '</bpmn:textAnnotation>'\
                            '<bpmn:association id="Association_17ypj4a" sourceRef="Activity_1iorly5" targetRef="TextAnnotation_08ilqab" />'\
                    '</bpmn:process>'\
               '</bpmn:definitions>'


        expected_turtle = rdflib.Graph().parse(data='''
            @prefix bboExtension: <https://www.irit.fr/recherches/MELODI/ontologies/BBO#> .
            @prefix rami: <https://w3id.org/i40/rami#> .
            @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
            @prefix teamingAI: <https://www.teamingai-project.eu/> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/Activity_1iorly5>
            rdfs:comment        "A Service Task is a Task that uses some sort of service, which could be a Web service or an automated application."@en;
            rdfs:label          "service task"@en;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBO#name> "Concrete";
            rdfs:subClassOf     <https://www.irit.fr/recherches/MELODI/ontologies/BBO#ServiceTask> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/Association_17ypj4a>
            rdfs:subClassOf     bboExtension:Association;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBOhas_sourceRef> <https://www.teamingai-project.eu/kg/process/qualityInspection/Activity_1iorly5>;
            <https://www.irit.fr/recherches/MELODI/ontologies/BBOhas_targetRef> <https://www.teamingai-project.eu/kg/process/qualityInspection/TextAnnotation_08ilqab> .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/TextAnnotation_08ilqab>
            rdfs:comment    "https://www.teamingai-project.eu/kg/process/qualityInspection/Concrete Service with Parameter in Activity Model"@en;
            rdfs:label      "text annotation"@en;
            rdfs:subClassOf     bboExtension:TextAnnotation .

            <https://www.teamingai-project.eu/kg/process/qualityInspection/teaming-engine-process-without-messages>
            rdfs:comment "representation of a business process using business process model and notation business ontology";
            rdfs:subClassOf bboExtension:Process;
            teamingAI:belongsToRAMILayer rami:Business;
            teamingAI:belongsToView teamingAI:BusinessProcessManagementView .
        ''', format='turtle')


        with bbo_extension_test(file_name='text_annotation', bpmn=bpmn) as result_turtle:

            assert len(result_turtle) != 0

            self.assertEqual(len(result_turtle - expected_turtle) == 0,
                            len(expected_turtle - result_turtle) == 0)


            select_text_annotation = '''
                SELECT ?s 
                WHERE { 
                    ?s rdfs:label "text annotation"@en . 
                }
            '''

            self.assertEqual(len(result_turtle.query(select_text_annotation)), 1)



if __name__ == '__main__':
    unittest.main()
