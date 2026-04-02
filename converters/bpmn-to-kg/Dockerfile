FROM ubuntu:20.04


RUN apt-get update && \
    apt-get install libncurses6 && \
    apt-get install openjdk-11-jdk --yes


RUN apt-get install python3 pip --yes && \
    apt-get install python-is-python3 && \
    pip install rdflib lxml


ADD ./bpmn_to_kg/ /bpmn_to_kg
ADD ./tests/ /tests


RUN python3 /tests/__init__.py


ENTRYPOINT ["python3", "bpmn_to_kg/__init__.py"]