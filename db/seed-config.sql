-- Replaces the placeholder symposium_config row with the real rubric
-- content, matching the old app's buildDefaultConfig(). Run this against
-- scoring_system_dev once the placeholder row already exists.
\encoding UTF8
INSERT INTO symposium_config (config)
VALUES( '{
  "conferenceTitle": "Embracing Global Engagement",
  "categories": [
    {
      "id": "poster",
      "name": "Poster",
      "maxPresentationNumber": 10,
      "usesTimeSlots": false,
      "usesRoom": false,
      "usesSession": false,
      "timeSlots": [],
      "rubric": {
        "scaleMin": 1,
        "scaleMax": 5,
        "scaleLabels": { "1": "Fair", "2": "Satisfactory", "3": "Good", "4": "Excellent", "5": "Superior" },
        "criteria": [
          {
            "id": "criterion1",
            "label": "Statement and Identification of Presentation Topic",
            "bullets": [
              "Is the topic of the poster presentation clearly stated?",
              "Does the presenter demonstrate understanding of existing knowledge regarding the presented topic?"
            ]
          },
          {
            "id": "criterion2",
            "label": "Global/International/Intercultural Connection",
            "bullets": ["Did the student demonstrate a connection to global/international/intercultural issues or themes?"]
          },
          {
            "id": "criterion3",
            "label": "Appearance/Clarity",
            "bullets": [
              "Is the poster logically organized and are the findings/conclusions clearly expressed?",
              "Does the poster effectively use headings, fonts, colors and white space?",
              "Is the poster text concise and error-free?",
              "Do the graphs, tables, pictures and/or illustrations include appropriate information?"
            ]
          },
          {
            "id": "criterion4",
            "label": "Poster Presentation Skills",
            "bullets": [
              "Did the student give a presentation that is clear to a non-specialized audience?",
              "Did the student define specialized terms as necessary?",
              "Does the student make eye contact and speak clearly with confidence & enthusiasm?"
            ]
          },
          {
            "id": "criterion5",
            "label": "Time Management",
            "bullets": ["Did the student remain within the allotted time frame?", "Did the student speak at an appropriate speed?"]
          },
          {
            "id": "criterion6",
            "label": "Audience Questions",
            "bullets": [
              "Did the student respond well to questions by the audience and judges?",
              "Is the student knowledgeable about the project?",
              "Did the student readily identify and explain the limitations of the project?"
            ]
          }
        ]
      },
      "openEndedQuestions": [
        { "id": "q1", "label": "What aspects of the presentation were done very well?" },
        { "id": "q2", "label": "What improvements should the student consider?" }
      ],
      "hasAbstractOption": false,
      "abstractCriterion": { "id": "abstract", "label": "Abstract", "bullets": [] }
    },
    {
      "id": "oral",
      "name": "Oral",
      "maxPresentationNumber": 10,
      "usesTimeSlots": true,
      "usesRoom": false,
      "usesSession": false,
      "timeSlots": [
        { "id": "slot1", "label": "9:00 – 9:20 AM", "rangeHint": "Presentations 1–5" },
        { "id": "slot2", "label": "9:20 – 9:40 AM", "rangeHint": "Presentations 6–10" }
      ],
      "rubric": {
        "scaleMin": 1,
        "scaleMax": 5,
        "scaleLabels": { "1": "Fair", "2": "Satisfactory", "3": "Good", "4": "Excellent", "5": "Superior" },
        "criteria": [
          {
            "id": "criterion1",
            "label": "Statement and Identification of Presentation Topic",
            "bullets": [
              "Is the topic of the presentation clearly stated?",
              "Does the presenter demonstrate understanding of existing knowledge regarding the presented topic?"
            ]
          },
          {
            "id": "criterion2",
            "label": "Global/International/Intercultural Connection",
            "bullets": ["Did the student demonstrate a connection to global/international/intercultural issues or themes?"]
          },
          {
            "id": "criterion3",
            "label": "Oral Presentation Skills",
            "bullets": [
              "Did the student give a presentation that is clear to a non-specialized audience?",
              "Did the student define specialized terms as necessary?",
              "Did the student speak clearly and at an appropriate speed?"
            ]
          },
          {
            "id": "criterion4",
            "label": "Audio-Visual Usage",
            "bullets": [
              "Did the student demonstrate skill in presenting their topic?",
              "Did the student use appropriate and engaging audio-visuals?"
            ]
          },
          {
            "id": "criterion5",
            "label": "Time Management",
            "bullets": ["Did the student remain within the allotted time frame?"]
          },
          {
            "id": "criterion6",
            "label": "Audience Questions",
            "bullets": ["Did the student respond well to questions by the audience and judges?"]
          }
        ]
      },
      "openEndedQuestions": [
        { "id": "q1", "label": "What aspects of the presentation were done very well?" },
        { "id": "q2", "label": "What improvements should the student consider?" }
      ],
      "hasAbstractOption": false,
      "abstractCriterion": { "id": "abstract", "label": "Abstract", "bullets": [] }
    },
    {
      "id": "video",
      "name": "Video",
      "maxPresentationNumber": 10,
      "usesTimeSlots": true,
      "usesRoom": false,
      "usesSession": false,
      "timeSlots": [
        { "id": "slot1", "label": "9:00 – 9:20 AM", "rangeHint": "Presentations 1–5" },
        { "id": "slot2", "label": "9:20 – 9:40 AM", "rangeHint": "Presentations 6–10" }
      ],
      "rubric": {
        "scaleMin": 1,
        "scaleMax": 5,
        "scaleLabels": { "1": "Fair", "2": "Satisfactory", "3": "Good", "4": "Excellent", "5": "Superior" },
        "criteria": [
          {
            "id": "criterion1",
            "label": "Statement and Identification of Presentation Topic",
            "bullets": [
              "Is the topic of the presentation clearly stated?",
              "Does the presenter demonstrate understanding of existing knowledge regarding the presented topic?"
            ]
          },
          {
            "id": "criterion2",
            "label": "Global/International/Intercultural Connection",
            "bullets": ["Did the student demonstrate a connection to global/international/intercultural issues or themes?"]
          },
          {
            "id": "criterion3",
            "label": "Oral Presentation Skills",
            "bullets": [
              "Did the student give a presentation that is clear to a non-specialized audience?",
              "Did the student define specialized terms as necessary?",
              "Did the student speak clearly and at an appropriate speed?"
            ]
          },
          {
            "id": "criterion4",
            "label": "Audio-Visual Usage",
            "bullets": [
              "Did the student demonstrate skill in presenting their topic?",
              "Did the student use appropriate and engaging audio-visuals?"
            ]
          },
          {
            "id": "criterion5",
            "label": "Time Management",
            "bullets": ["Did the student remain within the allotted time frame?"]
          },
          {
            "id": "criterion6",
            "label": "Audience Questions",
            "bullets": ["Did the student respond well to questions by the audience and judges?"]
          }
        ]
      },
      "openEndedQuestions": [
        { "id": "q1", "label": "What aspects of the presentation were done very well?" },
        { "id": "q2", "label": "What improvements should the student consider?" }
      ],
      "hasAbstractOption": false,
      "abstractCriterion": { "id": "abstract", "label": "Abstract", "bullets": [] }
    }
  ],
  "disciplines": []
}'::jsonb);

