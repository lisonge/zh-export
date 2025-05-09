import buffer from 'node:buffer';

const getStrHashCode = (str: string) => {
  let hash = 0,
    i,
    char;
  if (str.length === 0) return hash;
  for (i = 0; i < str.length; i++) {
    char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash;
};

const getKeyFromStr = (str: string): string => {
  const code = getStrHashCode(str);
  const a = buffer.Buffer.from(new Int32Array([code]).buffer)
    .toString('base64url')
    .replaceAll('-', '_');
  if (Number.isInteger(Number(a[0]))) {
    return '_' + a;
  }
  return a;
};

export default getKeyFromStr;
