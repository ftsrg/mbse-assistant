This repo contains a fork of the original project available at: https://git.ai.wu.ac.at/teaming-ai/business-process-management-to-knowledge-graph



# BPMN2KG: Business Process Model and Notation to Knowledge Graph
BPMN2KG is a Python command line tool that allows the transformation from a BPMN model in XML to a representation with the resource description framework (RDF). It aims to be a bridge between the fields business process management and semantic web.

Please cite the following paper ([Link to the commit to pertaining to the submission](https://git.ai.wu.ac.at/teaming-ai/business-process-management-to-knowledge-graph/-/tree/a2a6722c69fdd268f9685fa3095cee640ec3ac18)) if you use this software

```
@InProceedings{,
    author="
    Bachhofner, Stefan
    and Kiesling, Elmar
    and Revoredo, Kate
    and Waibel, Philipp
    and Polleres, Axel 
    ",
    title="Automated Process Knowledge Graph Construction from BPMN models",
    booktitle="International Conference on Database and Expert Systems Applications",
    year="2022",
    month="August",
    address="Vienna, Austria",
    publisher="Springer International Publishing",
}
```


# Installation

## PIP - Python Package Installer
You can install the command line tool with ```pip```.

```
pip install -e .
```

It is recommended that you use a conda environment.


## Docker
Create image from docker file.
```
docker build -f Dockerfile -t bpmn_to_kg .
```

Create container from image.

```
docker create --name BPMNtoKG bpmn_to_kg:latest
```

You can then run the command line application using the created container.

For example, the following command will print the help text
```
docker run bpmn_to_kg:latest --help
```


Say you want to transform a process within the farplas directory and save it into the turtle directory, then
```
docker run --mount type=bind,source=/home/bachhofner/Dev/business-process-management-to-knowledge-graph/bpmn/,destination=/bpmn --mount type=bind,source=/home/bachhofner/Dev/business-process-management-to-knowledge-graph/turtle,destination=/turtle bpmn_to_kg:latest --bpmn-input ./bpmn/farplas/process_without_messages.bpmn --ontology bbo --kg-output ./turtle/process_without_messsage.ttl
```
of course you have to change the path for source.
