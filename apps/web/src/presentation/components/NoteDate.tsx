const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

type NoteDateProps = {
  /** ISO 8601 timestamp. */
  value: string;
  /** Shows the time too, when the value has one. */
  withTime?: boolean;
};

export function NoteDate({ value, withTime = false }: NoteDateProps) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const format = withTime && value.includes("T") ? dateTimeFormat : dateFormat;
  return <time dateTime={value}>{format.format(date)}</time>;
}
