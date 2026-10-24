import type { NotePage } from "../types";
import type { Template } from "./index";
import { doc, h, p, tasks, text, ul, type TNode } from "./tiptap";

const page = (id: string, title: string, ...content: TNode[]): NotePage => ({ id, title, content: doc(...content), updatedAt: Date.now() });

export const templates: Template[] = [
  {
    name: "Personal journal",
    description: "Daily entries, goals and gratitude",
    body: {
      type: "notebook",
      color: "#db2777",
      sections: [
        {
          id: "journal",
          name: "Journal",
          color: "#db2777",
          pages: [
            page(
              "today",
              "Today",
              p(text("Mood: ", "bold"), ""),
              h(3, "Three things I'm grateful for"),
              ul("", "", ""),
              h(3, "What happened"),
              p(""),
              h(3, "Tomorrow"),
              tasks(""),
            ),
          ],
        },
        {
          id: "goals",
          name: "Goals",
          color: "#16a34a",
          pages: [page("year", "This year", h(2, "This year"), tasks("Health goal", "Career goal", "Learning goal", "Something just for fun"))],
        },
        { id: "ideas", name: "Ideas", color: "#ca8a04", pages: [page("ideas1", "Ideas", p("Anything worth remembering."))] },
      ],
    },
  },
  {
    name: "Project notebook",
    description: "Meetings, tasks, research and decisions",
    body: {
      type: "notebook",
      color: "#2563eb",
      sections: [
        {
          id: "overview",
          name: "Overview",
          color: "#2563eb",
          pages: [
            page("brief", "Project brief", h(2, "Goal"), p(""), h(2, "People"), ul("Owner: ", "Team: "), h(2, "Key dates"), ul("Kick-off: ", "Launch: ")),
          ],
        },
        {
          id: "meetings",
          name: "Meetings",
          color: "#7c3aed",
          pages: [page("kickoff", "Kick-off meeting", p(text("Attendees: ", "bold"), ""), h(3, "Notes"), p(""), h(3, "Action items"), tasks("", ""))],
        },
        { id: "tasks", name: "Tasks", color: "#ea580c", pages: [page("todo", "To do", tasks("First task", "Second task", "Third task"))] },
        { id: "research", name: "Research", color: "#0891b2", pages: [page("links", "Links and sources", ul(""))] },
      ],
    },
  },
  {
    name: "Class notes",
    description: "One section per subject",
    body: {
      type: "notebook",
      color: "#0891b2",
      sections: ["Maths", "Science", "History", "Languages"].map((name, i) => ({
        id: name.toLowerCase(),
        name,
        color: ["#2563eb", "#16a34a", "#ca8a04", "#db2777"][i],
        pages: [
          page(`${name.toLowerCase()}1`, "Lecture 1", h(2, "Lecture 1"), p(text("Topic: ", "bold"), ""), h(3, "Key ideas"), ul(""), h(3, "Questions"), ul("")),
        ],
      })),
    },
  },
];
