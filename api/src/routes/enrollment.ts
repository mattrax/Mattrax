import { Hono } from "hono";

export type EnrollmentProfileDescription = {
  data: string;
  createdAt: number;
};

export const enrollmentRouter = new Hono().post("/apple", async (c) => {
  // TODO
});

// TODO: Make this whole thing work without JS using form posts
// .post(
//     "/enroll/ios",
//     zValidator(
//       "json",
//       z.object({
//         // TODO: For now data is meant to replicate what auth would be
//         data: z.string(),
//       })
//     ),
//     async (c) => {
//       const input = c.req.valid("json");

//       // TODO: Use existing enrollment profile if it exists
//       const enrollmentProfile = await createEnrollmentProfile(
//         `enrollment-${Date.now()}`,
//         JSON.stringify({
//           data: input.data,
//           createdAt: Date.now(),
//         } satisfies EnrollmentProfileDescription)
//       );

//       const result = await exportEnrollmentProfile(enrollmentProfile!.id); // TODO: Why can `enrollmentProfile` be `undefined`???

//       return c.json({
//         value: result!.value,
//       });
//     }
