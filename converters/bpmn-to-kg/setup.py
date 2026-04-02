from setuptools import setup


import bpmn_to_kg


setup(
    name='bpmn_to_kg',
    packages=['bpmn_to_kg'],
    version=bpmn_to_kg.__version__,
    description=bpmn_to_kg.__description__,
    author=bpmn_to_kg.__author__,
    author_email=bpmn_to_kg.__author_email__,
    url='https://git.ai.wu.ac.at/teaming-ai/business-process-management-to-knowledge-graph',
    keywords=[
        'command line tool',
        'business process management', 'business process model and notation',
        'semantic web', 'knowledge graph',
        'model transformation', 'text-to-text transformation'
    ],
    install_requires=[
        'rdflib',
        'lxml'
    ],
    package_data={
        'bpmn_to_kg': ['rmlmapper-4.12.0-r361-all.jar', 'rml/bpmn_to_bbo.ttl']
    },
    entry_points='''
        [console_scripts]
        bpmn-to-kg=bpmn_to_kg.__init__:main
    '''
)