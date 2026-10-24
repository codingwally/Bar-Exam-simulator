import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./worker.mjs";
import { createTestDatabase } from "./test-support.mjs";

// Controlled local SQLite concurrency verifies completeness and race safety. It
// deliberately does not claim Cloudflare network throughput or production capacity.
for (const count of [13, 25, 50, 100]) {
  test(`${count} concurrent registrants save all 20 answers and obtain matching immutable receipts`, async (t) => {
    const db = createTestDatabase();
    const env = { EXAM_DB: db, EXAM_BACKUPS: { put: async () => {}, head: async () => null } };
    const app = createApp({
      adminAuthenticator: async () => ({ email: "synthetic@example.invalid" }),
    });
    const request = async (path, method = "GET", data, cookie) => {
      const response = await app.fetch(
        new Request(`https://exam.example.invalid${path}`, {
          method,
          headers: {
            Origin: "https://exam.example.invalid",
            "Content-Type": "application/json",
            ...(cookie ? { Cookie: cookie } : {}),
          },
          ...(data ? { body: JSON.stringify(data) } : {}),
        }),
        env,
        {},
      );
      const body = await response.json();
      assert.ok(
        response.status < 400,
        `${method} ${path}: ${response.status} ${JSON.stringify(body)}`,
      );
      return {
        body,
        cookie: response.headers.get("set-cookie")?.split(";")[0],
      };
    };
    const start = performance.now();
    try {
      await request("/api/admin/exams/official/draft", "PUT", {
        expected_version: 0,
        questions: Array.from({ length: 20 }, (_, index) => ({
          number: index + 1,
          text: `Synthetic load question ${index + 1}\nComplete second paragraph.`,
        })),
      });
      await request("/api/admin/exams/official/schedule", "POST", {
        expected_draft_version: 1,
        confirmed: true,
        starts_at: new Date(Date.now() + 86400000).toISOString(),
        ends_at: new Date(Date.now() + 90000000).toISOString(),
      });
      db.sqlite
        .prepare("UPDATE exams SET starts_at=?,ends_at=? WHERE slug='official'")
        .run(Date.now() - 1000, Date.now() + 3600000);
      const students = await Promise.all(
        Array.from({ length: count }, async (_, index) => {
          const editorId = `load-editor-${index}`;
          const registration = await request(
            "/api/exams/official/attempt",
            "POST",
            {
              name: `Synthetic student ${index}`,
              email: `load-${index}@example.invalid`,
              consent: true,
              oneBrowser: true,
              editorId,
              registrationId: crypto.randomUUID(),
            },
          );
          return { ...registration, index, editorId };
        }),
      );
      assert.equal(
        new Set(students.map((student) => student.body.attempt.id)).size,
        count,
      );
      for (let questionIndex = 0; questionIndex < 20; questionIndex++) {
        await Promise.all(
          students.map(async (student) => {
            const questionId = student.body.attempt.questions[questionIndex].id;
            const text = `Student ${student.index}; question ${questionIndex + 1}\nUnicode: ñ — preserved.\n${"Full answer. ".repeat(100)}`;
            const data = {
              editorId: student.editorId,
              revision: 1,
              operationId: crypto.randomUUID(),
              text,
            };
            const saved = await request(
              `/api/exams/official/answers/${questionId}`,
              "PUT",
              data,
              student.cookie,
            );
            assert.equal(saved.body.answer.text, text);
            if (questionIndex === 5) {
              const retried = await request(
                `/api/exams/official/answers/${questionId}`,
                "PUT",
                data,
                student.cookie,
              );
              assert.equal(retried.body.duplicate, true);
            }
          }),
        );
      }
      const receipts = await Promise.all(
        students.map(async (student) => {
          const result = await request(
            "/api/exams/official/submit",
            "POST",
            { editorId: student.editorId, operationId: crypto.randomUUID() },
            student.cookie,
          );
          const receipt = result.body.attempt.receipt;
          assert.equal(receipt.questionCount, 20);
          assert.equal(receipt.answeredCount, 20);
          const again = await request(
            "/api/exams/official/state",
            "GET",
            undefined,
            student.cookie,
          );
          assert.equal(again.body.attempt.receipt.checksum, receipt.checksum);
          assert.equal(again.body.attempt.answers.length, 20);
          return receipt;
        }),
      );
      assert.equal(new Set(receipts.map((receipt) => receipt.id)).size, count);
      assert.equal(
        db.sqlite.prepare("SELECT COUNT(*) n FROM final_answers").get().n,
        count * 20,
      );
      assert.equal(
        db.sqlite.prepare("SELECT COUNT(*) n FROM answer_operations").get().n,
        count * 20,
      );
      assert.equal(
        db.sqlite
          .prepare("SELECT COUNT(*) n FROM outbox WHERE target='owner_email'")
          .get().n,
        count,
      );
      t.diagnostic(
        `${count * 20} complete answers and ${count} receipts; local elapsed ${Math.round(performance.now() - start)} ms`,
      );
    } finally {
      db.close();
    }
  });
}
