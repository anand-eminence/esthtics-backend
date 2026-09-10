import { json, preflight, route } from "@/lib/http";

export const OPTIONS = preflight;

export const GET = route(async (req) =>
  json(req, {
    service: "tec-admin-api",
    consumer: "esthetics-frontend (TEC Admin panel)",
    routes: {
      health: "GET /api/health",
      auth: {
        login: "POST /api/admin/auth/login",
        me: "GET /api/admin/auth/me",
        logout: "POST /api/admin/auth/logout",
      },
      dashboard: "GET /api/admin/dashboard",
      themes: "GET /api/admin/themes",
      questions: "GET|POST /api/admin/questions",
      question: "GET|PATCH|DELETE /api/admin/questions/:id",
      schedule: "GET /api/admin/schedule?week=YYYY-MM-DD",
      featured: "GET|POST /api/admin/featured",
      featuredItem: "GET|PATCH|DELETE /api/admin/featured/:id",
      members: "GET /api/admin/members",
      member: "GET /api/admin/members/:id",
      statistics: "GET /api/admin/statistics?date=YYYY-MM-DD",
      settings: "GET|PATCH /api/admin/settings",
      users: "GET|POST /api/admin/users",
      quiz: {
        today: "GET /api/quiz/today?uid=&email=&name=",
        answer: "POST /api/quiz/answer",
        answers: "GET /api/quiz/answers?uid=&date=",
      },
    },
  }),
);
