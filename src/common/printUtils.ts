export const printSection = (
  title: string | null,
  ...args: { key: string; value: any }[]
) => {
  if (title) {
    console.log(".....................");
    console.log(title);
  }
  args.forEach(({ key, value }) => {
    if (typeof value === "object") {
      console.log(`   ${key}:`);
      for (const [k, v] of Object.entries(value)) {
        console.log(`      ${k}: ${v}`);
      }
    } else {
      if (typeof value === "number") {
        console.log(`   ${key}: ${value.toFixed(4)}`);
      } else {
        console.log(`   ${key}: ${value}`);
      }
    }
  });
};
