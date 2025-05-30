type ClassNamesArg =
  | undefined
  | string
  | Record<string, boolean>
  | ClassNamesArg[];

function appendClass(value: string, newClass: string | undefined) {
  if (!newClass) {
    return value;
  }

  if (value) {
    return value + " " + newClass;
  }

  return value + newClass;
}

function parseValue(arg: ClassNamesArg) {
  if (typeof arg === "string" || typeof arg === "number") {
    return arg;
  }

  if (typeof arg !== "object") {
    return "";
  }

  if (Array.isArray(arg)) {
    return classNames(...arg);
  }

  let classes = "";

  for (const key in arg) {
    if (arg[key]) {
      classes = appendClass(classes, key);
    }
  }

  return classes;
}

export function classNames(...args: ClassNamesArg[]): string {
  let classes = "";
  for (const arg of args) {
    classes = appendClass(classes, parseValue(arg));
  }
  return classes;
}
