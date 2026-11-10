# Model evaluation summary

Scorer: cue-contract-score v4
Closure digest: 887500035bdc8cac10acb88b27d486b0a4bca29dd51cd4373bf698a23e5016f1
Contract version: 0922aabf01ac
Fixtures passed/total: 29/29

Heuristic columns are not persona judgment.

## relationship-stages

**Contract**: replies through chunkVariant. **Heuristic**: emoji through meanWords. **Timing**: replies and generation latency/speed.

| Model | Config | replies | errors | blank | toolNoSpeech | parsed% | recovered% | rejected% | none% | leadCue% | acts | actsInert | invalidEmotion | inventedEmotions | forms b/c/j | intensity s/c/st/n/-/? | fields e/m/l/ld/pe | actions acc/unk | action tools unk/calls | gestures ok/drop/bare | breaks kept/ign | silent mk/wordless/alone | faces | delay valid/count | call valid/count | stripped | stageRejected | unknownMarkers | chunkVariant | emoji | stageDir | firstLower% | personaFace% | aiBreak | exampleEcho | meanWords | timing replies | meanTtftMs | meanTotalMs | genTps |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| granite4:latest | default@close | 4 | 0 | 0 | 0 | 100% | 0% | 0% | 0% | 100% | 4 | 0 | 0 | - | 4/0/0 | 0/0/0/0/4/0 | 0/0/0/0/0 | 0/0 | 0/0 | 0/0/0 | 0/0 | 0/0/0 | 0 | 0/0 | 0/0 | 0 | 0 | - | 0 | 0 | 0 | 0% | 0% | 0 | 0 | 33.75 | 4 | 28.25 | 532.5 | n/a |
| granite4:latest | default@friendly | 4 | 0 | 0 | 0 | 100% | 0% | 0% | 0% | 100% | 8 | 0 | 0 | - | 4/0/4 | 0/0/4/0/4/0 | 0/0/0/0/0 | 0/0 | 0/0 | 0/0/0 | 0/0 | 0/0/0 | 0 | 0/0 | 0/0 | 0 | 0 | - | 0 | 4 | 0 | 0% | 0% | 0 | 0 | 22.25 | 4 | 25.25 | 544.5 | n/a |
| granite4:latest | default@intimate | 4 | 0 | 0 | 0 | 100% | 0% | 0% | 0% | 100% | 8 | 0 | 2 | excited: 1, thoughtful: 1 | 4/0/4 | 0/1/3/0/4/0 | 4/4/0/0/0 | 0/0 | 0/0 | 1/3/0 | 0/0 | 0/0/0 | 0 | 0/0 | 0/0 | 0 | 0 | - | 0 | 0 | 0 | 0% | 0% | 0 | 0 | 32.5 | 4 | 31 | 827 | n/a |
| granite4:latest | default@stranger | 4 | 0 | 0 | 0 | 100% | 0% | 0% | 0% | 100% | 4 | 0 | 0 | - | 4/0/0 | 0/0/0/0/4/0 | 0/0/0/0/0 | 0/0 | 0/0 | 0/0/0 | 0/0 | 0/0/0 | 0 | 0/0 | 0/0 | 0 | 0 | - | 0 | 0 | 0 | 0% | 0% | 0 | 0 | 20.5 | 4 | 30.75 | 435 | n/a |
