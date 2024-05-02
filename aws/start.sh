#!/bin/bash
# TODO: This will end up as an autoscaling group in the Cloudformation template.

export SECURITY_GROUP_ID="sg-0e3607fed2f02df1d"

aws --region us-east-1 ec2 run-instances --image-id ami-0092a7ee6b8b2222a --count 1 --instance-type t4g.micro --key-name MyLaptopOrSomething --security-group-ids $SECURITY_GROUP_ID --user-data file://$(dirname "$0")/bootstrap.sh