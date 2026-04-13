import os
import argparse
import subprocess

import logging
import pathlib


import lxml
import rdflib




__description__ = 'Command Line Interface for Business Process Model and Notation (BPMN) '\
                  'to Knowledge Graph (KG).'

__author__ = 'Stefan Bachhofner <stefan.bachhofner@wu.ac.at>'
__author_email__ = 'stefan.bachhofner@wu.ac.at'

__license__ = 'MIT'
__version__ = '0.1.0-alpha'
__author_email__ = 'stefan.bachhofner@wu.ac.at'



logging.basicConfig(level=logging.INFO)





def handle_bbo() -> pathlib.Path:
    '''
        Returns the path to the BBO mapping file.

        Returns
        --------
        path : pathlib.Path
            A Path object with the path to the BBO mapping file.

        Example
        --------
        >>> handle_bbo()
        PosixPath('/home/bachhofner/Dev/business-process-management-to-knowledge-graph/rml/bpmn_to_bbo.ttl')
    '''
    return pathlib.Path(
            os.path.join(os.path.dirname(os.path.realpath(__file__)), 'rml/bpmn_to_bbo.ttl'))


def handle_bbo_extension() -> pathlib.Path:
    '''
        Returns the path to the BBOExtension mapping file.

        Returns
        --------
        path : pathlib.Path
            A Path object with the path to the BBOExtension mapping file.

        Example
        --------
        >>> handle_bbo_extension()
        PosixPath('/home/bachhofner/Dev/business-process-management-to-knowledge-graph/rml/union_bbo_and_bbo_extension.ttl')
    '''
    bpmn_to_bbo = rdflib.Graph().parse(str(
            os.path.join(os.path.dirname(os.path.realpath(__file__)), 'rml/bpmn_to_bbo.ttl')), format='turtle')

    bpmn_to_bbo_extension = rdflib.Graph().parse(str(
        os.path.join(os.path.dirname(os.path.realpath(__file__)), 'rml/bpmn_to_bbo_extension.ttl')), format='turtle')

    kg = bpmn_to_bbo + bpmn_to_bbo_extension
    
    kg.serialize(str(
        os.path.join(os.path.dirname(os.path.realpath(__file__)), 'rml/union_bbo_and_bbo_extension.ttl')), format='turtle')

    ontology = os.path.join(
        os.path.dirname(os.path.realpath(__file__)), 'rml/union_bbo_and_bbo_extension.ttl')

    return ontology


handle_ontology = {
    'bbo': handle_bbo(),
    'bboextension': handle_bbo_extension()
}





def set_rml_source(bpmn_to_ontology_mapping, bpmn_input) -> None:
    '''
        This function
            1. Loads the mapping specified in bpmn_to_ontology_mapping,
            2. Sets the object of all rml:source to bpmn_input, and
            3. Seralizes the resulting knoweldge graph

        
        Parameters
        ----------
        bpmn_to_ontology_mapping: pathlib.Path
            A pathlib.Path object to the mapping file.
        bpmn_input: pathlib.Path
            A pathlib.Path object to the BPMN XML file.
    '''
    logging.info(f'Loading RML BPMN ontology Mapping file : {bpmn_to_ontology_mapping}.')   
    kg = rdflib.Graph().parse(str(bpmn_to_ontology_mapping), format="turtle")

    bpmn_input = rdflib.Literal(str(bpmn_input))

    logging.info(f'Setting rml:source to {bpmn_input}.')
    for sub, pred, obj in kg.triples((None, rdflib.term.URIRef('http://semweb.mmlab.be/ns/rml#source'), None)):
        
        kg.set((sub, pred, bpmn_input))
        
        logging.debug(f'Replaced triple ({sub}, {pred}, {obj}) with triple ({sub}, {pred}, {bpmn_input}).')


    logging.info(f'Saving RML BPMN ontology mapping file : {bpmn_to_ontology_mapping}.')
    kg.serialize(str(bpmn_to_ontology_mapping), format="turtle")


def set_rml_source_object_to_empty_string(bpmn_to_ontology_mapping) -> None:
    '''
        This function sets an object in a tripple to ' ' if the predicate of the triple is
        rml:source.

        
        Parameters
        ----------
        bpmn_to_ontology_mapping: pathlib.Path
            A pathlib.Path object to the mapping file.
    '''
    set_rml_source(bpmn_to_ontology_mapping=bpmn_to_ontology_mapping,
                   bpmn_input=' ')


def set_uri_template(bpmn_to_ontology_mapping, uri_template) -> None:
    '''
        This function
            1. Loads the mapping specified in bpmn_to_ontology_mapping,
            2. Sets suffix of all the triples with rr:template as their predicate to bpmn_input, and
            3. Seralizes the resulting knoweldge graph

        
        Parameters
        ----------
        bpmn_to_ontology_mapping: pathlib.Path
            A pathlib.Path object to the mapping file.
        bpmn_input: pathlib.Path
            A pathlib.Path object to the BPMN XML file.
    '''

    def add_uri_suffix_to_uri_template(uri_suffix, uri_template) -> str:
        '''
            This function exchanges the URI suffix in uri_template with uri_suffix.


            Parameters
            ----------
            uri_suffix: str
                The URI suffix with such be prependend.
            uri_template: str or an object that supports str
                The rr:template string.


            Examples
            ----------
            >>> add_uri_suffix_to_uri_template(uri_suffix='https://www.teamingai-project.eu/kg/process/qualityInspection/',
                                              uri_template='{@id}')
            'https://www.teamingai-project.eu/kg/process/qualityInspection/{@id}'
            >>> add_uri_suffix_to_uri_template(uri_suffix='https://www.teamingai-project.eu/kg/',
                                              uri_template='{@id}')
            'https://www.teamingai-project.eu/kg/process/qualityInspection/{@id}'
        '''
        uri_template = str(uri_template).partition('{')
        uri_template = list(uri_template)
        uri_template[0] = uri_suffix
        return ''.join(uri_template)


    logging.info(f'Loading RML BPMN ontology Mapping file : {bpmn_to_ontology_mapping}.')
    kg = rdflib.Graph().parse(str(bpmn_to_ontology_mapping), format="turtle")


    logging.info(f'Setting rr:template suffix to {uri_template}.')
    for sub, pred, obj in kg.triples((None, rdflib.term.URIRef('http://www.w3.org/ns/r2rml#template'), None)):

        _uri_template = rdflib.Literal(add_uri_suffix_to_uri_template(uri_suffix=uri_template, uri_template=obj))
        
        kg.set((sub, pred, _uri_template))

        logging.debug(f'Replaced triple ({sub}, {pred}, {obj}) with triple ({sub}, {pred}, {_uri_template})')


    logging.info(f'Saving RML BPMN ontology mapping file : {bpmn_to_ontology_mapping}.')
    kg.serialize(str(bpmn_to_ontology_mapping), format="turtle")



def remove_uri_template_uri_suffix(bpmn_to_ontology_mapping) -> None:
    '''
        This function removes all characters - up to, but not including, the first { - in an object if the 
        predicate of the triple is rr:template.

        
        Parameters
        ----------
        bpmn_to_ontology_mapping: pathlib.Path
            A pathlib.Path object to the mapping file.
    '''
    set_uri_template(bpmn_to_ontology_mapping=bpmn_to_ontology_mapping,
                    uri_template='')



def execute_rml(bpmn_to_ontology_mapping, kg_output, serialization_format) -> None:
    '''
        This function executes the rmlmapper.

        Parameters
        ----------
        bpmn_to_ontology_mapping: pathlib.Path
            A pathlib.Path object to the mapping file.
        kg_output: pathlib.Path
            A pathlib.Path object to the directory to which the kg should be saved, including
            the name of the file.
        serialization_format: str
            A string indicating the format of the output file.
    '''
    logging.info(f'Starting transformation with mapping file {bpmn_to_ontology_mapping} and attempting to save to {kg_output}.')


    cmd = f'java '\
          f'-jar {os.path.join(os.path.dirname(os.path.realpath(__file__)), "rmlmapper-4.12.0-r361-all.jar")} '\
          f'--mapping {bpmn_to_ontology_mapping} '\
          f'--output {kg_output} '\
          f'--serialization {serialization_format}'
    try:
        subprocess.run(cmd, capture_output=True, shell=True)

    except subprocess.CalledProcessError as e:
        logging.debug(e)


    try:
        rdflib.Graph().parse(str(kg_output), format=serialization_format)
    except Exception:
        logging.exception("Transformation failed")
        raise
    else:
        logging.info(f'Transformation successfull, file saved to {kg_output}')


def main():
    parser = argparse.ArgumentParser(
        description='Command Line Interface for Business Process Model and Notation (BPMN) '\
                    'to Knowledge Graph (KG).')


    parser.add_argument(
        '--bpmn-input',
        type=pathlib.Path,
        required=True,
        help='Path to a BPMN file or a directory where BPMN files are stored')

    parser.add_argument(
        '--ontology',
        type=str,
        default='BBO',
        required=False,
        choices=['bbo', 'BBO', 'bboExtension', 'BBOExtension'],
        help='Ontology to which the BPMN file shall be mapped to, default is BBO')

    parser.add_argument(
        '--kg-output',
        type=pathlib.Path,
        required=True,
        help='Path to the output directory to which the KG file shall be written')

    parser.add_argument(
        '--uri-template',
        type=str,
        default='https://www.teamingai-project.eu/kg/process/qualityInspection/',
        help="URI suffix to be used")

    parser.add_argument(
        '--serialization-format',
        type=str,
        default='turtle',
        choices=['turtle', 'trig', 'trix', 'jsonld', 'hdt', 'nquads'],
        help='File format of the output file.')


    args = parser.parse_args()




    '''
        Perform set up tasks.
    '''
    # Deal with command line inpus
    args.ontology = handle_ontology[args.ontology.lower()]

    args.kg_output = args.kg_output.absolute()

    args.bpmn_input = args.bpmn_input.absolute()


    if args.bpmn_input.is_file():
        # Prepare mapping file.
        set_rml_source(bpmn_to_ontology_mapping=args.ontology,
                    bpmn_input=args.bpmn_input)

        set_uri_template(bpmn_to_ontology_mapping=args.ontology,
                        uri_template=args.uri_template)


        '''
            Execute transformation.
        '''
        execute_rml(bpmn_to_ontology_mapping=args.ontology,
                    kg_output=args.kg_output,
                    serialization_format=args.serialization_format)

    if args.bpmn_input.is_dir():
        bpmn_files = args.bpmn_input.glob('*.bpmn')

        for bpmn_file in bpmn_files:
            # Prepare mapping file.
            set_rml_source(bpmn_to_ontology_mapping=args.ontology,
                           bpmn_input=bpmn_file)

            set_uri_template(bpmn_to_ontology_mapping=args.ontology,
                            uri_template=args.uri_template)


            '''
                Execute transformation.
            '''
            execute_rml(bpmn_to_ontology_mapping=args.ontology,
                        kg_output=bpmn_file.with_name(bpmn_file.stem + '.ttl'),
                        serialization_format=args.serialization_format)

    '''
        Clean up mapping file.
    '''
    set_rml_source_object_to_empty_string(bpmn_to_ontology_mapping=args.ontology)

    remove_uri_template_uri_suffix(bpmn_to_ontology_mapping=args.ontology)


if __name__ == "__main__":
    main()
