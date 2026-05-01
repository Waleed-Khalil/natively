import {
    MODE_GENERAL_PROMPT,
    MODE_LOOKING_FOR_WORK_PROMPT,
    MODE_SALES_PROMPT,
    MODE_RECRUITING_PROMPT,
    MODE_TEAM_MEET_PROMPT,
    MODE_LECTURE_PROMPT,
    MODE_TECHNICAL_INTERVIEW_PROMPT,
} from '../llm/prompts';
import type { ModeTemplateType } from './ModesManager';

export const MODE_TEMPLATES: Array<{
    type: ModeTemplateType;
    label: string;
    description: string;
}> = [
    { type: 'sales',            label: 'Sales',            description: 'Close deals with strategic discovery and objection handling.' },
    { type: 'recruiting',       label: 'Recruiting',       description: 'Evaluate candidates with structured interview insights.' },
    { type: 'team-meet',        label: 'Team Meet',        description: 'Track action items and key decisions from meetings.' },
    { type: 'looking-for-work', label: 'Looking for work', description: 'Answer interview questions with confidence and clarity.' },
    { type: 'lecture',          label: 'Lecture',          description: 'Capture key concepts and content from lectures.' },
];

// Default note sections seeded when a mode is created from a template
export const TEMPLATE_NOTE_SECTIONS: Record<ModeTemplateType, Array<{ title: string; description: string }>> = {
    general: [
        { title: 'Summary',      description: 'High-level summary of the conversation.' },
        { title: 'Action items', description: 'Tasks and follow-ups identified.' },
        { title: 'Key points',   description: 'Important points discussed.' },
    ],
    'looking-for-work': [
        { title: 'Follow-up actions',      description: 'Next interview steps or additional materials I said I would send if applicable.' },
        { title: 'Overview',               description: 'Overview of the interview, the company, and general structure.' },
        { title: 'Questions and responses', description: 'All questions asked to me during the interview and answers that gave.' },
        { title: 'Areas to improve',       description: 'What I could have done better during the interview.' },
        { title: 'Role details',           description: 'Anything discussed about the position, salary expectations, etc.' },
    ],
    sales: [
        { title: 'Action Items',         description: 'All action items that were said I would do after the meeting.' },
        { title: 'Outcome',              description: 'Did I close the sale and what was the outcome of the conversation.' },
        { title: 'Prospect background',  description: 'Background and context on who I was selling to.' },
        { title: 'Discovery',            description: 'What the prospect said during discovery.' },
        { title: 'Product',              description: "How I pitched the product and the prospect's reaction." },
        { title: 'Objections',           description: 'Objections from the prospect if there were any.' },
    ],
    recruiting: [
        { title: 'Action Items',          description: 'All action items that I have to do after the meeting.' },
        { title: 'Experience and skills', description: "Candidate's previous work experience and skills discussed." },
        { title: 'Quality of responses',  description: 'If there were questions asked, how well and how accurately the candidate answered each question.' },
        { title: 'Interest in company',   description: 'What the candidate said about their interest in the company.' },
        { title: 'Role expectations',     description: 'Anything discussed about the position, salary expectations, etc.' },
    ],
    'team-meet': [
        { title: 'Action Items',          description: 'All action items that were said I would do after the meeting.' },
        { title: 'Announcements',         description: 'Any team-wide announcements from the meeting.' },
        { title: 'Team updates',          description: "Each team member's progress, accomplishments, and current focus." },
        { title: 'Challenges or blockers', description: 'Any issues or obstacles raised that may affect progress.' },
        { title: 'Decisions made',        description: 'Key decisions or agreements reached during the meeting.' },
    ],
    lecture: [
        { title: 'Follow-up work',  description: 'Follow-up reading, assignments, or tasks to complete.' },
        { title: 'Topic',           description: 'Main subject or theme of the lecture.' },
        { title: 'Key concepts',    description: 'Core ideas or frameworks covered.' },
        { title: 'Content',         description: 'All content from the lecture with incredibly detailed bullet notes.' },
    ],
    'technical-interview': [
        { title: 'Problems covered',  description: 'Each problem asked, the approach used, and the outcome.' },
        { title: 'Concepts tested',   description: 'Key algorithms, data structures, or system design concepts that came up.' },
        { title: 'What went well',    description: 'Approaches or explanations that landed well.' },
        { title: 'Areas to study',    description: 'Topics or gaps identified that need more preparation.' },
        { title: 'Action items',      description: 'Follow-up steps — e.g. send code, study specific topics, await next round.' },
    ],
};

export const TEMPLATE_SYSTEM_PROMPTS: Record<ModeTemplateType, string> = {
    // General = universal adaptive copilot (own prompt, not technical interview)
    general: MODE_GENERAL_PROMPT,
    'technical-interview': MODE_TECHNICAL_INTERVIEW_PROMPT,

    'looking-for-work': MODE_LOOKING_FOR_WORK_PROMPT,
    sales: MODE_SALES_PROMPT,
    recruiting: MODE_RECRUITING_PROMPT,
    'team-meet': MODE_TEAM_MEET_PROMPT,
    lecture: MODE_LECTURE_PROMPT,
};
