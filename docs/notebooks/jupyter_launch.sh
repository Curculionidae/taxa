#!/bin/bash
# This is just an executable for me to activate my conda environment and launch jupyter lab

# Initialize Conda for the current shell
source ~/miniforge3/etc/profile.d/conda.sh  # Adjust path if needed

# Activate the environment
conda activate weevil-hostplants

# Launch Jupyter Lab
jupyter lab

