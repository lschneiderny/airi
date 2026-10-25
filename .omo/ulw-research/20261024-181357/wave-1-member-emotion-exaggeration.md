# A7 emotion-exaggeration (lane st_01a16f2d, journaled 2026-10-24T23:03:04.150Z)

st_01a16f2d [completed] transcript via event-log:
assistant: I read this as an evidence review of emotional exaggeration for a small Live2D desktop character - I’ll retrieve primary studies and separate findings from design inferences. I'll stop right away when every requested topic has sourced coverage or an explicit evidence gap, with leads and source observations recorded.

tool: todo
assistant: The retrieval plan covers the requested face, body, motion-quality, appeal, and size questions. You need: 0/6 tasks done; primary-source findings will be distinguished from design hypotheses. Now: Find facial exaggeration and perception studies. Next: Find emotional body language and timing studies.

tool: eval
tool: tool_search
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: tool_search
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
error: No credential slots available
assistant: Ask: research axis A7, exaggeration in emotional face and body motion for a small Live2D character. Wanted: sourced findings with leads, claims and observations. For you: face, body and EMOTE sources are in hand. Display size, uncanny valley and anime conventions are still missing. Now: Find appeal and display size evidence. Next: Synthesize findings and practical design implications.
tool: eval
assistant: Ask: A7 research on emotional exaggeration in a small Live2D desktop character. Wanted: sourced findings, with leads, claims and observations. For you: face-motion, body-language, EMOTE and uncanny-valley findings are sourced. I found no direct evidence on scaling exaggeration with display size, and nothing on anime or Live2D acting conventions. I also never read the Mousas or McDonnell papers themselves. Several sources are known from abstracts only. Now: Synthesize findings and practical design implications. Next: Report claims leads and source observations.

All access dates are 2026-10-24. No web_search results came back at all (the tool returned blanks). I used webfetch against Crossref, OpenAlex, Europe PMC, PubMed, PMC, a CMU project page and an r.jina.ai text mirror. The quotes under OBSERVATIONS show which fetches worked. The ACM, IEEE, Wiley and ScienceDirect publisher pages were blocked, so the Wallbott, Hyde and Kleinsmith details come from abstracts or open mirrors.

## Findings

**Face**
- Exaggerating facial motion raises perceived emotion intensity (Pollick et al. 2003), and caricatured motion is categorised more accurately (Furl et al.).
- Exaggeration does not help every character. In Hyde et al. 2013, damped motion improved likeability and intelligence ratings for cartoon characters, while realistic-looking characters gained from more motion. The effect appeared within ±20% of the original motion, tested in 10% steps up to ±40%. So "cartoon means exaggerate" is not supported by that study.
- More facial motion also read as more extraverted. Exaggeration therefore shifts perceived personality as well as emotion.
- Speed carries emotion on the face (Emotion 2021). Happy and angry are faster, sad is slowest. Speeding an expression up pushes judgments toward anger and happiness, and slowing it pushes toward sad. This effect is separate from the shape cues.
- Pollick 2003 found that shorter durations gave slightly lower intensity ratings. Fast does not mean more intense; speed mostly signals which emotion it is.

**Body**
- Activation (arousal) explains most body movement differences between emotions (Wallbott 1998).
- Pollick 2001: the first perceived dimension of affect is activation, and it tracks movement kinematics. Pleasantness depends on the phase relations between limb segments.
- Gait: walking speed is fastest for joy and anger and slowest for sadness. Neck and thoracic flexion with sadness, and trunk extension with joy, were independent of speed. Posture is therefore a second channel besides tempo.
- Dael 2012: most emotions are expressed by multiple body-movement patterns, not one prototype. That supports giving each emotion several variants.
- Dael 2013: arousal and potency strongly shape how gestural dynamics are perceived. Valence differences are weaker.
- Kleinsmith and Bianchi-Berthouze: body expressions are as powerful as facial expressions at conveying emotion.

**EMOTE and Laban**
- Effort has four factors: Space, Weight, Time and Flow. Each runs from -1 to +1.
- Shape has three dimensions, with the poles Spreading/Enclosing, Rising/Sinking and Advancing/Retreating.
- Parameters can be set per body part and phrased across a gesture. This gives a small set of continuous controls that could drive Live2D parameters.
- The paper says full-body engagement makes a gesture read as convincing.

**Appeal and uncanny risk**
- Piwek et al. 2014 found no confirmation that motion deepens the uncanny valley.
- Schindler et al. 2017 used stylized characters at six levels from abstract to realistic. Their ERP results suggest a U-shaped response in brain processing, which I could not read in full.
- Both findings are about realistic or semi-realistic characters. For a flat anime-style Live2D model, uncanny risk from exaggeration is not shown in anything I retrieved. The more likely risks are personality shift (Hyde) and annoyance from repeated large motion, which I have no source for.

**Display size and viewing distance**
- I found no study that scales exaggeration with character size.
- A glaucoma study measured the distance at which facial expressions become recognisable, using a simulated face of 0.36° × 0.5° at 20 m. That gives a method but not a rule for animators.
- Treat any size scaling as a design hypothesis to test on the real corner-of-desktop model.

**Live2D tooling (documentation, not perception evidence)**
- Standard parameter ranges can be extended past their defaults.
- Expressions are static states. Motion clips are separate. This matches the held-state plus gesture-clip design.

## Practical inferences (my reasoning, not source claims)
- Exaggerate the cues that discriminate emotions: amplitude on mouth and brow, head and torso posture, and timing contrast. Don't just scale everything up.
- Keep sad slow, and angry and happy fast.
- Use Effort/Shape-style parameters (time, weight, flow, rising/sinking) as per-emotion presets.
- Give each emotion two or three gesture variants.
- Keep small-scale facial motion modest. Move exaggeration into head tilt, torso posture and clip timing, which stay visible when the model is small.
- Test a 0.8×, 1.0× and 1.3× amplitude ladder on the real model at real size. The cartoon-damped result in Hyde argues against assuming "more is better."

## EXPAND
- LEAD: Hyde et al. FG 2013 full PDF - WHY: only the abstract was read, so the per-emotion results and effect sizes are unverified - ANGLE: the CMU PDF is over 5 MB, so fetch a text mirror or a Semantic Scholar copy; the CMU HTTPS certificate failed but HTTP works
- LEAD: Mousas, "The effects of appearance and motion of virtual characters on emotional reactivity" (Computers in Human Behavior, 2018, doi 10.1016/j.chb.2018.04.036) - WHY: it directly tests appearance against motion, but I only confirmed the title - ANGLE: Purdue author PDFs at web.ics.purdue.edu/~cmousas/papers/
- LEAD: McDonnell-group studies of emotion transfer, cartoon versus realistic faces, and virtual-human perception - WHY: this is the named author with the strongest virtual-character perception record, and her publications page was not reachable - ANGLE: Google Scholar by exact title; Costigan and McDonnell "Speech independent emotion transfer for virtual faces" (doi 10.1145/2813852.2813862) is a confirmed candidate
- LEAD: Full text of the Pollick 2003 recognition paper - WHY: the Wollongong Unpaywall PDF would give effect sizes for the exaggeration levels - ANGLE: https://ro.uow.edu.au/cgi/viewcontent.cgi?article=2014&context=hbspapers
- LEAD: Full text of the Emotion 2021 face-kinematics paper (PMC8582590) - WHY: Experiments 3 and 4 give the actual speed-manipulation factors, which are directly usable for tuning clip timing - ANGLE: it was truncated at 50 KB in my fetch, so re-fetch the later sections
- LEAD: Spatial-frequency and size effects on expression recognition (Smith and Schyns style work), plus emoji and small-avatar legibility studies - WHY: this is the only route to evidence on scaling with display size - ANGLE: Europe PMC queries on "spatial frequency", "low resolution" and "emoticon legibility"
- LEAD: Anime and Live2D acting conventions (sweat drops, chibi deformation, head tilt, flinch) - WHY: no scholarly source retrieved - ANGLE: animator talks and Live2D community guides, which would be practitioner knowledge rather than perception evidence
- DEAD END: web_search returned blanks for every query; Google and Bing via webfetch returned unusable or irrelevant results
- DEAD END: ScienceDirect, ACM, IEEE, Wiley and doi.org were blocked or returned captchas; the CMU and Penn HTTPS hosts failed certificate checks, though the CMU PDF worked over HTTP via a mirror
- DEAD END: Crossref title queries for "viewing distance" and for Pollick/Dael returned nothing useful; Europe PMC returned nothing for Mousas emotion papers or for cartoon-avatar emotion

## CLAIMS
- CLAIM: Spatial exaggeration of facial motion raises perceived emotion intensity, and shorter expression duration slightly lowers it - RISK: normal - SOURCES: europepmc.org, pubmed.ncbi.nlm.nih.gov - COUNTER: the study used point-light faces, not stylized characters - PRIMARY: Pollick et al. 2003, Perception, doi 10.1068/p3319
- CLAIM: Spatiotemporal caricature of facial movement improves perceived distinctness of expressions (animated head, 1.7× caricature level) - RISK: normal - SOURCES: pmc.ncbi.nlm.nih.gov - COUNTER: it did not help identity recognition; it was tested on a realistic head model - PRIMARY: Furl et al., Perception 2022, PMC9017061
- CLAIM: Cartoon characters were rated better with damped facial motion, and realistic-looking ones with increased motion; more motion also read as more extraverted - RISK: high - SOURCES: graphics.cs.cmu.edu - COUNTER: it measured likeability, intelligence and extraversion rather than emotion recognition; only the abstract was read - PRIMARY: Hyde, Carter, Kiesler and Hodgins, FG 2013, doi 10.1109/FG.2013.6553775
- CLAIM: Facial movement speed is an independent emotion cue: happy and angry are faster, sad is slower, and speeding or slowing expressions shifts judgments accordingly - RISK: normal - SOURCES: pmc.ncbi.nlm.nih.gov - COUNTER: posed, spontaneous and spoken contexts differ in which face actions carry the effect - PRIMARY: Emotion 2021, doi 10.1037/emo0000835
- CLAIM: Body emotion differences are largely explained by activation, with some emotion-specific posture and movement beyond that - RISK: normal - SOURCES: openalex.org - COUNTER: actors' portrayals, not natural behaviour; large encoder differences - PRIMARY: Wallbott 1998, Eur. J. Social Psychology
- CLAIM: Most emotions are produced through several body-movement patterns, not one prototype - RISK: normal - SOURCES: europepmc.org - COUNTER: only ten professional actors - PRIMARY: Dael, Mortillaro and Scherer 2012, doi 10.1037/a0025737
- CLAIM: Perceived affect from movement has an activation dimension that tracks kinematics, while pleasantness depends on limb phase relations - RISK: normal - SOURCES: europepmc.org - COUNTER: two actors, point-light arm movements only - PRIMARY: Pollick et al. 2001, Cognition, doi 10.1016/s0010-0277(01)00147-0
- CLAIM: Effort-Shape qualities and gait speed separate emotions: joy and anger are fastest, sadness slowest, with posture effects beyond speed - RISK: normal - SOURCES: europepmc.org - COUNTER: walking only, sixteen participants - PRIMARY: Human Movement Science 2011, doi 10.1016/j.humov.2011.05.001
- CLAIM: EMOTE parameterizes motion quality with Effort (Space, Weight, Time, Flow) and Shape on -1 to +1 scales, applied per body part and phrased across key poses - RISK: normal - SOURCES: graphics.cs.cmu.edu via r.jina.ai - COUNTER: it was built for arm and torso gestures in 3D; the mapping to Live2D parameters is untested - PRIMARY: Chi, Costa, Zhao and Badler, SIGGRAPH 2000, doi 10.1145/344779.352172
- CLAIM: Adding motion does not systematically deepen the uncanny valley for realistic characters - RISK: normal - SOURCES: europepmc.org - COUNTER: full-body realistic characters, abstract read only - PRIMARY: Piwek, McKay and Pollick 2014, Cognition, doi 10.1016/j.cognition.2013.11.001
- CLAIM: No retrieved source gives a rule for scaling emotional exaggeration with display size or viewing distance - RISK: high - SOURCES: europepmc.org - COUNTER: a literature on spatial frequency and expression recognition probably exists but was not found - PRIMARY: none located

## OBSERVATIONS
- OBS: http://graphics.cs.cmu.edu/projects/poafe/ - "The realistic-looking characters benefited from increased motion whereas the cartoon characters benefitted from damped motion." - observed_at 2026-10-24
- OBS: https://www.ebi.ac.uk/europepmc/webservices/rest/search (PMID 12974567) - "exaggeration of facial expressions relative to a fixed neutral expression resulted in enhanced ratings of the intensity" - observed_at 2026-10-24
- OBS: https://pmc.ncbi.nlm.nih.gov/articles/PMC8582590/ - "speeding up facial expressions promotes anger and happiness judgments, and slowing down expressions encourages sad judgments." - observed_at 2026-10-24
- OBS: https://pmc.ncbi.nlm.nih.gov/articles/PMC9017061/ - "Caricature increased physical dissimilarity between faces differing in expression" - observed_at 2026-10-24
- OBS: https://api.openalex.org/works/https://doi.org/10.1002/(SICI)1099-0992(1998110)28:6%3C879::AID-EJSP901%3E3.0.CO;2-W - "differences between emotions can be partly explained by the dimension of activation" - observed_at 2026-10-24
- OBS: https://www.ebi.ac.uk/europepmc/webservices/rest/search (PMID 22059517) - "most emotions were variably expressed by multiple patterns" - observed_at 2026-10-24
- OBS: https://www.ebi.ac.uk/europepmc/webservices/rest/search (PMID 24422246) - "Arousal and potency were found to be strong determinants of the perception of gestural dynamics" - observed_at 2026-10-24
- OBS: https://www.ebi.ac.uk/europepmc/webservices/rest/search (PMID 11716834) - "Dimension 1 of the psychological space was highly correlated to the kinematics of the movement." - observed_at 2026-10-24
- OBS: https://www.ebi.ac.uk/europepmc/webservices/rest/search (PMID 21835480) - "Walking speed was fastest for joy and anger, and slowest for sadness." - observed_at 2026-10-24
- OBS: https://mdsoar.org/bitstreams/bd220721-aaa5-40f2-8bab-c392b96cf93b/download - "body expressions are as powerful as facial expressions in conveying emotions" - observed_at 2026-10-24
- OBS: http://graphics.cs.cmu.edu/nsp/course/15-464/Fall05/papers/chi00emote.pdf (via r.jina.ai) - "Effort comprises four motion factors: Space, Weight, Time, and Flow." - observed_at 2026-10-24
- OBS: http://graphics.cs.cmu.edu/nsp/course/15-464/Fall05/papers/chi00emote.pdf (via r.jina.ai) - "Each Effort and Shape factor is associated with a scale ranging from -1 to +1." - observed_at 2026-10-24
- OBS: https://www.ebi.ac.uk/europepmc/webservices/rest/search (PMID 24374019) - "it has been claimed but never directly tested that movement would accentuate this dip" - observed_at 2026-10-24
- OBS: https://www.ebi.ac.uk/europepmc/webservices/rest/search (PMID 28332557) - "professionally stylized happy, angry, and neutral character faces" - observed_at 2026-10-24
- OBS: https://www.ebi.ac.uk/europepmc/webservices/rest/search (PMID 30347086) - "simulating the angular size of a face viewed at 20 m" - observed_at 2026-10-24
- OBS: https://docs.live2d.com/en/cubism-editor-manual/standard-parametor-list/ - "To rotate a head more than -30 to 30, set -45 to 45, etc." - observed_at 2026-10-24
- OBS: https://docs.live2d.com/en/cubism-sdk-manual/expression/ - "There is no change in value over time." - observed_at 2026-10-24
