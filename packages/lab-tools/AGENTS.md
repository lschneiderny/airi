# Lab Tools Guide

- Results inform tuning and never gate landing. Never retune a gate, band, or scorer constant to make a failing run pass; failures are findings.
- Import qa-tools only through its `exports`. A module lab-tools needs from qa-tools is added there, never copied.
- Model-eval sets under `model-eval/sets/` are records: their transcripts and summaries keep the paths and commands they were made with.
- Rig, model, or core assets are not committed.
