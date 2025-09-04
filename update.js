const fs = require("fs");
const startTag = "<!-- GOL_START -->";
const endTag = "<!-- GOL_END -->";
const BACK_QUOTE = "`";
const getData = (input) => {    
    const startIdx = input.indexOf(startTag) + startTag.length;
    const endIdx = input.indexOf(endTag);
    const data = input.substring(startIdx, endIdx);
    return data;
}

const getCells = (data) => {
    const rows = data.trim().split('\n').map(row => row.replace(/`/g, '').replace(/<\/br>/g, ''));
    const cells = rows.map(row => row.split('').map(cell => cell === '*' || cell === '+'));
    return cells;
}

const getNbNeighbors = (x, y, cells) => {
    let nbNeighbors = 0;
    for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
            if (i === 0 && j === 0) continue;
            const neighborX = x + i;
            const neighborY = y + j;
            if (neighborX >= 0 && neighborX < cells[0].length && neighborY >= 0 && neighborY < cells.length) {
                nbNeighbors += cells[neighborY][neighborX] ? 1 : 0;
            }
        }
    }
    return nbNeighbors;
}

const computeNextGeneration = (data) => {
    return data.map((row, y) => row.map((cell, x) => {
        const nbNeighbors = getNbNeighbors(x, y, data);
        if (cell) {
            return nbNeighbors === 2 || nbNeighbors === 3;
        }
        return nbNeighbors === 3;
    }));
}

const render = (updatedData, existingData) => {
    return `\n${data.map((_, y) => `${BACK_QUOTE}${row.map((_, x) => renderCell(updatedData[y][x], existingData[y][x])).join('')}${BACK_QUOTE}</br>`).join(`\n`)}\n`;
}
const renderCell = (updatedCell, existingCell) => {
    if (updatedCell) {
        if (existingCell) {
            return '*';
        }
        return '+';
    }
    if (existingCell) {
        return 'x';
    }
    return '.';
}

const updateGOL = (input) => {
    const data = getData(input);
    const existingData = getCells(data);
    const updatedData = computeNextGeneration(existingData);
    const rendered = render(updatedData, existingData);
    return [data, rendered];
}

const updateMetadata = (input) => {
    const matches = [...input.matchAll(/`Iteration: (\d+) Updated: ([^`]*)`$/gm)];
    const metadata = matches[0][0];
    const iteration = matches[0][1];
    const updated = `${BACK_QUOTE}Iteration: ${Number(iteration) + 1} Updated: ${new Date().toLocaleString()}${BACK_QUOTE}`;
    return [metadata, updated];
}

const update = () => {
    const input = fs.readFileSync("README.md", "utf8");
    // update GOL representation
    const [data, rendered] = updateGOL(input);
    // update metadata
    const [metadata, renderedMetadata] = updateMetadata(input);
    const output = input
        .replace(data, rendered)
        .replace(metadata, renderedMetadata);
    fs.writeFileSync("README.md", output);
}

update();