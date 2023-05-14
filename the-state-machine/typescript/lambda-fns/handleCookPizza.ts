exports.handler = async function(event:any, _context:any) {
    // For the sake of simplicity, we are returning a success response.
    return {status: 'success', message: 'Pizza cooked successfully!'};
}