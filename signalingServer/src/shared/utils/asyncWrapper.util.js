// funciton to handle the async funcitons
function asyncWrapper(fn) {

    return (req, res, next) => {
        return Promise.resolve(fn(req, res, next)).catch(err => next(err));
    }

}

export default asyncWrapper;
