import type { InquiryComment, InquiryItem, ResearchProfile } from "@/lib/mockData";
import { cleanHandle, isDeletedComment } from "@/lib/symposiumCore";

export const projectProfileIntoComments = (
  comments: InquiryComment[],
  person: ResearchProfile
): InquiryComment[] =>
  comments.map((comment) => ({
    ...comment,
    author:
      !isDeletedComment(comment) &&
      comment.authorHandle &&
      cleanHandle(comment.authorHandle) === person.handle
        ? person.name
        : comment.author,
    replies: projectProfileIntoComments(comment.replies ?? [], person)
  }));

export const projectProfileIntoInquiryItems = (
  items: InquiryItem[],
  person: ResearchProfile
) =>
  items.map((item) => ({
    ...item,
    author: item.authorHandle === person.handle ? person.name : item.author,
    comments: projectProfileIntoComments(item.comments, person)
  }));
